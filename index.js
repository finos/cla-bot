const ursa = require('ursa');
const fs = require('fs');

const privateKey = ursa.createPrivateKey(fs.readFileSync('clabotkey.pem'));
const defaultConfig = JSON.parse(fs.readFileSync('default.json'));

exports.handler = ({ body }, context, callback, request) => {
  // TODO: log callback invocations
  if (body.action !== 'opened') {
    callback(null, {'message': 'ignored action of type ' + body.action});
    return;
  }

  const clabotToken = process.env.GITHUB_ACCESS_TOKEN;

  // for test purposes we pass in a mocked request object
  request = request || require('request');

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
    console.log('GitHub API Request', opts.url);
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

  const user = body.pull_request.user.login;
  const issueUrl = body.pull_request.issue_url;

  githubRequest({
    url: body.repository.url + '/contents/.clabot',
    method: 'GET'
  })
  .then(body => githubRequest({
    url: body.download_url,
    method: 'GET'
  }))
  .then(config => {

    config = Object.assign({}, defaultConfig, config);

    const userToken = privateKey.decrypt(config.token, 'base64', 'utf8');
    const statusUrl = body.repository.url + '/statuses/' + body.pull_request.head.sha;

    if (config.contributors.indexOf(user) !== -1) {
      console.log(`CLA approved for ${user} - adding label ${config.label} to ${issueUrl}`);
      // TODO: what if the label doesn't exists?
      return githubRequest({
        url: issueUrl + '/labels',
        body: [config.label]
      }, userToken)
      .then(body => githubRequest({
        url: statusUrl,
        body: {
          state: 'success',
          context: 'verification/cla-signed'
        }
      }, userToken))
      .then(() => callback(null, {'message': `added label ${config.label} to ${issueUrl}`}));
    } else {
      console.log(`CLA not found for ${user} - adding a comment to ${issueUrl}`);
      return githubRequest({
        url: issueUrl + '/comments',
        body: {body: config.message}
      })
      .then(body => githubRequest({
        url: statusUrl,
        body: {
          state: 'failure',
          context: 'verification/cla-signed'
        }
      }, userToken))
      .then(() => callback(null, {'message': `CLA has not been signed by ${user}, added a comment to ${issueUrl}`}));
    }
  })
  .catch((err) => {
    callback(err.toString());
  });
};
