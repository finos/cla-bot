const NodeRSA = require('node-rsa');
const fs = require('fs');

const defaultConfig = JSON.parse(fs.readFileSync('default.json'));

const getReadmeUrl = (context) => ({
  url: context.webhook.repository.url + '/contents/.clabot',
  method: 'GET'
});

const getReadmeContents = (body) => ({
  url: body.download_url,
  method: 'GET'
});

const addLabel = (context) => ({
  url: context.webhook.pull_request.issue_url + '/labels',
  body: [context.config.label]
});

const getCommits = (context) => ({
  url: context.webhook.pull_request.url + '/commits',
  method: 'GET'
});

const setStatus = (context, state) => ({
  url: context.webhook.repository.url + '/statuses/' + context.webhook.pull_request.head.sha,
  body: {
    state,
    context: 'verification/cla-signed'
  }
});

const addComment = (context) => ({
  url: context.webhook.pull_request.issue_url + '/comments',
  body: {
    body: context.config.message
  }
});

const getNonContributors = (committers, config) => {
  const isContributor = (user) => config.contributors.indexOf(user) !== -1;
  return Promise.resolve(committers.filter(c => !isContributor(c)));
};

exports.handler = ({ body }, lambdaContext, callback, config = {}) => {

  const loggingCallback = (err, message) => {
    console.log('callback', err, message);
    callback(err, message);
  };

  // TODO: log callback invocations
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
  const githubRequest = (opts, token = clabotToken) => new Promise((resolve, reject) => {
    // merge the standard set of HTTP request options
    const mergedOptions = Object.assign({}, {
      json: true,
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'github-cla-bot'
      },
      method: 'POST'
    }, opts);

    // perform the request
    console.log('GitHub API Request', opts.url, opts.body);
    request(mergedOptions, (error, response, body) => {
      if (error) {
        // TODO: does this reveal anything sensitive to the client? (i.e. the webhook)
        reject(error.toString());
      } else if (response && response.statusCode && !response.statusCode.toString().startsWith('2')) {
        // TODO: does this reveal anything sensitive to the client? (i.e. the webhook)
        reject(new Error('GitHub API request failed with status ' + response.statusCode));
      } else {
        resolve(body);
      }
    });
  });

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
      return getNonContributors(committers, context.config);
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
