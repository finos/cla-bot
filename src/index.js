const fs = require("fs");
const path = require("path");
const contributionVerifier = require("./contributionVerifier");
const installationToken = require("./installationToken");
const is = require("is_js");
const uuid = require("uuid/v4");
const githubApi = require("./githubApi");
const logger = require("./logger");

const defaultConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "default.json"))
);

const sortUnique = arr =>
  arr
    .sort((a, b) => a - b)
    .filter((value, index, self) => self.indexOf(value, index + 1) === -1);

const validAction = webhook =>
  webhook.action === "opened" ||
  webhook.action === "synchronize" ||
  // issues do not have a body.issue.pull_request property, whereas PRs do
  (webhook.action === "created" && webhook.issue.pull_request);

// depending on the event type, the way the location of the PR and issue URLs are different
const gitHubUrls = webhook =>
  webhook.action === "created"
    ? {
        pullRequest: webhook.issue.pull_request.url,
        issue: webhook.issue.url
      }
    : {
        pullRequest: webhook.pull_request.url,
        issue: webhook.pull_request.issue_url
      };

const commentSummonsBot = comment =>
  comment.match(new RegExp(`@${process.env.BOT_NAME}(\\[bot\\])?\\s*check`)) !==
  null;

const obtainToken = async webhook => {
  // if we are running as an integration, obtain the required integration token
  if (
    process.env.INTEGRATION_ENABLED &&
    process.env.INTEGRATION_ENABLED === "true"
  ) {
    logger.info(
      "Bot installed as an integration, obtaining installation token"
    );
    return await installationToken(webhook.installation.id);
  } else {
    logger.info("Bot installed as a webhook, using access token");
    return process.env.GITHUB_ACCESS_TOKEN;
  }
};

const response = body => ({
  statusCode: 200,
  body: JSON.stringify(body)
});

const applyToken = token => {
  const api = {};
  githubRequest = githubApi.githubRequest;
  Object.keys(githubApi).forEach(apiMethod => {
    api[apiMethod] = (...args) =>
      githubRequest(githubApi[apiMethod].apply(null, args), token);
  });
  return api;
};

// the lambda interface is a bit clumsy, this adapts it into something more manageable
const constructHandler = fn => async ({ body }, lambdaContext, callback) => {
  try {
    // serverless takes the request body and stringifies it
    const res = await fn(JSON.parse(body));

    if (typeof res === "string") {
      logger.debug("integration webhook callback response", res);
      callback(null, response({ message: res }));
    } else {
      logger.error(`unexpected lambda function return value ${res}`);
    }
  } catch (err) {
    logger.error(err.toString());
    callback(err.toString());
  }

  logger.flush();
};

exports.handler = constructHandler(async webhook => {
  logger.debug("lambda invoked", webhook);

  if (!validAction(webhook)) {
    return `ignored action of type ${webhook.action}`;
  }

  const { pullRequest: pullRequestUrl, issue: issueUrl } = gitHubUrls(webhook);

  // determine the URL for storing the event log
  const org = pullRequestUrl.split("/")[4];
  const logUrl = `${org}-${uuid()}`;
  const logFile = `https://s3.amazonaws.com/${
    process.env.LOGGING_BUCKET
  }/${logUrl}`;
  logger.logFile(logUrl);

  if (webhook.action === "created") {
    if (!commentSummonsBot(webhook.comment.body)) {
      return "the comment didnt summon the cla-bot";
    } else {
      if (webhook.comment.user.login === `${process.env.BOT_NAME}[bot]`) {
        return "the cla-bot summoned itself. Ignored!";
      }
      logger.info("The cla-bot has been summoned by a comment");
    }
  }

  logger.info(`Checking CLAs for pull request ${pullRequestUrl}`);

  // obtain the token and apply it to all of our API methods
  const token = await obtainToken(webhook);
  const {
    getLabels,
    getOrgConfig,
    getReadmeUrl,
    getFile,
    addLabel,
    getCommits,
    setStatus,
    addCommentNoCLA,
    addCommentUnidentified,
    deleteLabel,
    addRecheckComment
  } = applyToken(token);

  logger.info("Obtaining the list of commits for the pull request");
  const commits = await getCommits(pullRequestUrl);

  logger.info(
    `Total Commits: ${commits.length}, checking CLA status for committers`
  );

  // PRs include the head sha, for comments we have to determine this from the commit history
  let headSha;
  if (webhook.pull_request) {
    headSha = webhook.pull_request.head.sha;
  } else {
    headSha = commits[commits.length - 1].sha;
  }

  const unresolvedLoginNames = sortUnique(
    commits.filter(c => c.author == null).map(c => c.commit.author.name)
  );

  let orgConfig;
  try {
    logger.info("Attempting to obtain organisation level .clabot file URL");
    orgConfig = await getOrgConfig(webhook);
    logger.info("Organisation configuration found!");
  } catch (e) {
    logger.info(
      "Organisation configuration not found, resolving .clabot URL at project level"
    );
    orgConfig = await getReadmeUrl(webhook);
  }

  logger.info(
    `Obtaining .clabot configuration file from ${
      orgConfig.download_url.split("?")[0]
    }`
  );

  const config = await getFile(orgConfig);

  if (!is.json(config)) {
    logger.error("The .clabot file is not valid JSON");
    await setStatus(webhook, headSha, "error", logFile);
    throw new Error("The .clabot file is not valid JSON");
  }

  // merge with default config options
  const botConfig = Object.assign({}, defaultConfig, config);

  const removeLabelAndSetFailureStatus = async users => {
    await deleteLabel(issueUrl, botConfig.label);
    await setStatus(webhook, headSha, "error", logFile);
    return `CLA has not been signed by users ${users}, added a comment to ${pullRequestUrl}`;
  };

  let message;
  if (unresolvedLoginNames.length > 0) {
    const unidentifiedString = unresolvedLoginNames.join(", ");
    logger.info(
      `Some commits from the following contributors are not signed with a valid email address: ${unidentifiedString}. `
    );
    await addCommentUnidentified(
      issueUrl,
      botConfig.messageMissingEmail,
      unidentifiedString
    );
    message = await removeLabelAndSetFailureStatus(unidentifiedString);
  } else {
    const committers = sortUnique(
      commits.map(c => c.author.login.toLowerCase())
    );
    const verifier = contributionVerifier(botConfig);
    const nonContributors = await verifier(committers, token);

    if (nonContributors.length === 0) {
      logger.info(
        "All contributors have a signed CLA, adding success status to the pull request and a label"
      );

      const labels = await getLabels(issueUrl);

      // check whether this label already exists
      if (!labels.some(l => l.name === botConfig.label)) {
        await addLabel(issueUrl, botConfig.label);
      } else {
        logger.info(
          `The pull request already has the label ${botConfig.label}`
        );
      }

      await setStatus(webhook, headSha, "success", logFile);

      message = `added label ${botConfig.label} to ${pullRequestUrl}`;
    } else {
      const usersWithoutCLA = nonContributors
        .map(contributorId => `@${contributorId}`)
        .join(", ");
      logger.info(
        `The contributors ${usersWithoutCLA} have not signed the CLA, adding error status to the pull request`
      );
      await addCommentNoCLA(issueUrl, botConfig.message, usersWithoutCLA);

      message = await removeLabelAndSetFailureStatus(usersWithoutCLA);
    }
  }

  if (webhook.action === "created") {
    await addRecheckComment(issueUrl, botConfig.recheckComment);
  }

  return message;
});

exports.test = {
  commentSummonsBot
};
