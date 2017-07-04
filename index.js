const fs = require('fs');
const contributionVerifier = require('./contributionVerifier');
const installationToken = require('./installationToken');
const uuid = require('uuid/v1');
const is = require('is_js');
const { githubRequest, getOrgConfig, getReadmeUrl, getFile, addLabel, getCommits, setStatus, addComment, deleteLabel } = require('./githubApi');

const defaultConfig = JSON.parse(fs.readFileSync('default.json'));

// a token value used to indicate that an organisation-level .clabot file was not found
const noOrgConfig = false;

const validAction = action =>
  ['opened', 'synchronize', 'issue_comment'].indexOf(action) !== -1;

const commentSummonsBot = comment =>
  comment.match(new RegExp(`@${process.env.BOT_NAME}(\\[bot\\])?\\s*check`)) !== null;

exports.handler = ({ body }, lambdaContext, callback) => {
  const loggingCallback = (error, message) => {
    console.info('DEBUG', 'integration webhook callback response', { error, message });
    callback(error, message);
  };

  if (!validAction(body.action)) {
    loggingCallback(null, { message: `ignored action of type ${body.action}` });
    return;
  }

  if (body.action === 'issue_comment' && !commentSummonsBot(body.comment.body)) {
    return;
  }

  // adapt the console messages to add a correlation key
  const correlationKey = uuid();
  // we use console.info because AWS logs this, however, we can suppress console.info
  // when running the unit tests to given a cleaner output
  const adaptee = console.info;
  console.info = (level, message, detail) => {
    adaptee(JSON.stringify({
      time: new Date().toISOString(),
      correlationKey,
      level,
      message,
      detail
    }));
  };

  const context = {
    webhook: body,
    correlationKey
  };

  console.info('INFO', `Checking CLAs for pull request ${context.webhook.pull_request.url}`);

  Promise.resolve()
    .then(() => {
      // if we are running as an integration, obtain the required integration token
      if (process.env.INTEGRATION_ENABLED && process.env.INTEGRATION_ENABLED === 'true') {
        console.info('INFO', 'Bot installed as an integration, obtaining installation token');
        return installationToken(context.webhook.installation.id);
      } else {
        console.info('INFO', 'Bot installed as a webhook, using access token');
        return process.env.GITHUB_ACCESS_TOKEN;
      }
    })
    .then((token) => {
      context.userToken = token;
      console.info('INFO', 'Attempting to obtain organisation level .clabot file URL');
      return githubRequest(getOrgConfig(context), context.userToken);
    })
    // if the request to obtain the org-level .clabot file returns a non 2xx response
    // (typically 404), this catch block returns a 'token' value that indicates a
    // project level file should be requested
    .catch(() => ({ noOrgConfig }))
    .then((orgConfig) => {
      if ('noOrgConfig' in orgConfig) {
        console.info('INFO', 'Organisation configuration not found, resolving .clabot URL at project level');
        return githubRequest(getReadmeUrl(context), context.userToken);
      } else {
        console.info('INFO', 'Organisation configuration not found');
        return orgConfig;
      }
    })
    .then((orgConfig) => {
      console.info('INFO', `Obtaining .clabot configuration file from ${orgConfig.download_url}`);
      return githubRequest(getFile(orgConfig), context.userToken);
    })
    .then((config) => {
      if (!is.json(config)) {
        throw new Error('The .clabot file is not valid JSON');
      }
      console.info('INFO', 'Obtaining the list of commits for the pull request');
      context.config = Object.assign({}, defaultConfig, config);
      return githubRequest(getCommits(context), context.userToken);
    })
    .then((commits) => {
      console.info('INFO', `A total of ${commits.length} were found, checking CLA status for committers`);
      const committers = commits.map(c => c.author.login);
      const verifier = contributionVerifier(context.config);
      return verifier(committers, context.userToken);
    })
    .then((nonContributors) => {
      if (nonContributors.length === 0) {
        console.info('INFO', 'All contributors have a signed CLA, adding success status to the pull request and a label');
        return githubRequest(addLabel(context), context.userToken)
          .then(() => githubRequest(setStatus(context, 'success'), context.userToken))
          .then(() => loggingCallback(null, { message: `added label ${context.config.label} to ${context.webhook.pull_request.url}` }));
      } else {
        const usersWithoutCLA = nonContributors.map(contributorId => `@${contributorId}`)
          .join(', ');
        console.info('INFO', `The contributors ${usersWithoutCLA} have not signed the CLA, adding error status to the pull request`);
        return githubRequest(addComment(context, usersWithoutCLA), context.userToken)
          .then(() => githubRequest(deleteLabel(context), context.userToken))
          .then(() => githubRequest(setStatus(context, 'error'), context.userToken))
          .then(() => loggingCallback(null,
            { message: `CLA has not been signed by users ${usersWithoutCLA}, added a comment to ${context.webhook.pull_request.url}` }));
      }
    })
    .catch((err) => {
      console.info('ERROR', err.toString());
      githubRequest(setStatus(context, 'failure'), context.userToken)
        .then(() => loggingCallback(err.toString()));
    });
};

exports.test = {
  commentSummonsBot
};
