const fs = require('fs');
const contributionVerifier = require('./contributionVerifier');
const installationToken = require('./installationToken');
const { githubRequest, getOrgConfig, getReadmeUrl, getFile, addLabel, getCommits, setStatus, addComment, deleteLabel } = require('./githubApi');

const defaultConfig = JSON.parse(fs.readFileSync('default.json'));

// a token value used to indicate that an organisation-level .clabot file was not found
const noOrgConfig = false;

const validAction = action =>
  ['opened', 'synchronize'].indexOf(action) !== -1;

exports.handler = ({ body }, lambdaContext, callback) => {
  const loggingCallback = (err, message) => {
    console.info('callback', err, message);
    callback(err, message);
  };

  if (!validAction(body.action)) {
    loggingCallback(null, { message: `ignored action of type ${body.action}` });
    return;
  }

  const context = {
    webhook: body
  };

  console.info(`Checking CLAs for PR ${context.webhook.pull_request.url}`);

  Promise.resolve()
    .then(() => {
      // if we are running as an integration, obtain the required integration token
      if (process.env.INTEGRATION_ENABLED && process.env.INTEGRATION_ENABLED === 'true') {
        return installationToken(context.webhook.installation.id);
      } else {
        return process.env.GITHUB_ACCESS_TOKEN;
      }
    })
    .then((token) => {
      context.userToken = token;
      return githubRequest(getOrgConfig(context), context.userToken);
    })
    // if the request to obtain the org-level .clabot file returns a non 2xx response
    // (typically 404), this catch block returns a 'token' value that indicates a
    // project level file should be requested
    .catch(() => ({ noOrgConfig }))
    .then((orgConfig) => {
      if ('noOrgConfig' in orgConfig) {
        console.info('Resolving .clabot at project level');
        return githubRequest(getReadmeUrl(context), context.userToken);
      } else {
        console.info('Using org-level .clabot');
        return orgConfig;
      }
    })
    .then(orgConfig => githubRequest(getFile(orgConfig), context.userToken))
    .then((config) => {
      context.config = Object.assign({}, defaultConfig, config);
      return githubRequest(getCommits(context), context.userToken);
    })
    .then((commits) => {
      const committers = commits.map(c => c.author.login);
      const verifier = contributionVerifier(context.config);
      return verifier(committers, context.userToken);
    })
    .then((nonContributors) => {
      if (nonContributors.length === 0) {
        return githubRequest(addLabel(context), context.userToken)
          .then(() => githubRequest(setStatus(context, 'success'), context.userToken))
          .then(() => loggingCallback(null, { message: `added label ${context.config.label} to ${context.webhook.pull_request.url}` }));
      } else {
        const usersWithoutCLA = nonContributors.map(contributorId => `@${contributorId}`)
          .join(', ');
        return githubRequest(addComment(context, usersWithoutCLA), context.userToken)
          .then(() => githubRequest(deleteLabel(context), context.userToken))
          .then(() => githubRequest(setStatus(context, 'failure'), context.userToken))
          .then(() => loggingCallback(null,
            { message: `CLA has not been signed by users ${usersWithoutCLA}, added a comment to ${context.webhook.pull_request.url}` }));
      }
    })
    .catch((err) => {
      loggingCallback(err.toString());
    });
};
