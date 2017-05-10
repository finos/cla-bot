const NodeRSA = require('node-rsa');
const fs = require('fs');

const defaultConfig = JSON.parse(fs.readFileSync('default.json'));

const getReadmeUrl = ({webhook}) => ({
  url: webhook.repository.url + '/contents/.clabot',
  method: 'GET'
});

const getReadmeContents = (body) => ({
  url: body.download_url,
  method: 'GET'
});

const addLabel = ({webhook, config}) => ({
  url: webhook.pull_request.issue_url + '/labels',
  body: [config.label]
});

const getCommits = ({webhook}) => ({
  url: webhook.pull_request.url + '/commits',
  method: 'GET'
});

const setStatus = ({webhook}, state) => ({
  url: webhook.repository.url + '/statuses/' + webhook.pull_request.head.sha,
  body: {
    state,
    context: 'verification/cla-signed'
  }
});

const addComment = ({webhook, config}) => ({
  url: webhook.pull_request.issue_url + '/comments',
  body: {
    body: config.message
  }
});

const requestAsPromise = (request) => (opts) => new Promise((resolve, reject) => {
  console.log('API Request', opts.url, opts.body || {});
  request(opts, (error, response, body) => {
    if (error) {
      reject(error.toString());
    } else if (response && response.statusCode && !response.statusCode.toString().startsWith('2')) {
      reject(new Error(`API request ${opts.url} failed with status ${response.statusCode}`));
    } else {
      resolve(body);
    }
  });
});

const verifyContributors = (committers, {config}, request) => {
  if (config.contributors) {
    const isContributor = (user) => config.contributors.indexOf(user) !== -1;
    return Promise.resolve(committers.filter(c => !isContributor(c)));
  } else if (config.contributorListUrl) {
    return requestAsPromise(request)({
      url: config.contributorListUrl,
      json: true
    })
    .then((contributors) => {
      const isContributor = (user) => contributors.indexOf(user) !== -1;
      return committers.filter(c => !isContributor(c));
    });
  }
};

exports.handler = ({ body }, lambdaContext, callback, config = {}) => {

  const loggingCallback = (err, message) => {
    console.log('callback', err, message);
    callback(err, message);
  };

  if (body.action !== 'opened') {
    loggingCallback(null, {'message': 'ignored action of type ' + body.action});
    return;
  }

  const clabotToken = process.env.GITHUB_ACCESS_TOKEN;
  const context = {
    webhook: body
  };

  // for test purposes we pass in mocked external dependencies
  const request = config.request || require('request');
  const privateKey = config.key || new NodeRSA(fs.readFileSync('clabotkey.pem'));

  // adapts the request API to provide generic handling of HTTP / transport errors and
  // error responses from the GitHub API.
  const githubRequest = (opts, token = clabotToken) =>
    requestAsPromise(request)(Object.assign({}, {
      json: true,
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'github-cla-bot'
      },
      method: 'POST'
    }, opts));

  console.log(`Checking CLAs for PR ${context.webhook.pull_request.url}`);

  githubRequest(getReadmeUrl(context))
    .then(body => githubRequest(getReadmeContents(body)))
    .then(config => {
      context.userToken = privateKey.decrypt(config.token, 'utf8');
      context.config = Object.assign({}, defaultConfig, config);
      return githubRequest(getCommits(context), context.userToken);
    })
    .then((commits) => {
      const committers = commits.map(c => c.author.login);
      return verifyContributors(committers, context, request);
    })
    .then((nonContributors) => {
      if (nonContributors.length === 0) {
        return githubRequest(addLabel(context), context.userToken)
          .then(() => githubRequest(setStatus(context, 'success'), context.userToken))
          .then(() => loggingCallback(null, {'message': `added label ${context.config.label} to ${context.webhook.pull_request.url}`}));
      } else {
        return githubRequest(addComment(context))
          .then(() => githubRequest(setStatus(context, 'failure'), context.userToken))
          .then(() => loggingCallback(null,
            {'message': `CLA has not been signed by users [${nonContributors.join(', ')}], added a comment to ${context.webhook.pull_request.url}`}));
      }
    })
    .catch((err) => {
      loggingCallback(err.toString());
    });
};
