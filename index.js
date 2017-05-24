const fs = require('fs');
const requestp = require('./requestAsPromise');
const contributionVerifier = require('./contributionVerifier');
const installationToken = require('./installationToken');
const {githubRequest, getOrgConfig, getReadmeUrl, getReadmeContents, addLabel, getCommits, setStatus, addComment, deleteLabel} = require('./githubApi');

const defaultConfig = JSON.parse(fs.readFileSync('default.json'));

const validAction = (action) =>
  ['opened', 'synchronize'].indexOf(action) !== -1;

exports.handler = ({ body }, lambdaContext, callback) => {

  const loggingCallback = (err, message) => {
    console.log('callback', err, message);
    callback(err, message);
  };

  if (!validAction(body.action)) {
    loggingCallback(null, {'message': 'ignored action of type ' + body.action});
    return;
  }

  const clabotToken = process.env.GITHUB_ACCESS_TOKEN;
  const context = {
    webhook: body
  };

  console.log(`Checking CLAs for PR ${context.webhook.pull_request.url}`);

  githubRequest(getOrgConfig(context),clabotToken)
    .then(body => {
      if (!body.name || body.name == "") {
        console.log("Couldn't fetch .clabot from Github organisation project; trying at project level");
        return githubRequest(getReadmeUrl(context),clabotToken);
      }
      return body;
    })
    .then(body => githubRequest(getReadmeContents(body),clabotToken))
    .then(config => {
      context.config = Object.assign({}, defaultConfig, config);
      // if we are running as an integration, obtain the required integration token, otherwise
      if (process.env.INTEGRATION_ENABLED && process.env.INTEGRATION_ENABLED === 'true') {
        return installationToken(context.webhook.installation.id);
      } else {
        return clabotToken;
      }
    })
    .then(token => {
      context.userToken = token;
      return githubRequest(getCommits(context), context.userToken);
    })
    .then((commits) => {
      const committers = commits.map(c => c.author.login);
      const verifier = contributionVerifier(context.config);
      return verifier(committers);
    })
    .then((nonContributors) => {
      if (nonContributors.length === 0) {
        return githubRequest(addLabel(context), context.userToken)
          .then(() => githubRequest(setStatus(context, 'success'), context.userToken))
          .then(() => loggingCallback(null, {'message': `added label ${context.config.label} to ${context.webhook.pull_request.url}`}));
      } else {
        return githubRequest(addComment(context),clabotToken)
          .then(() => githubRequest(deleteLabel(context), context.userToken))
          .then(() => githubRequest(setStatus(context, 'failure'), context.userToken))
          .then(() => loggingCallback(null,
            {'message': `CLA has not been signed by users [${nonContributors.join(', ')}], added a comment to ${context.webhook.pull_request.url}`}));
      }
    })
    .catch((err) => {
      loggingCallback(err.toString());
    });
};
