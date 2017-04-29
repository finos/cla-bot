const ursa = require('ursa');
const fs = require('fs');

const privateKey = ursa.createPrivateKey(fs.readFileSync('clabotkey.pem'));

const defaultMessage = 'Thank you for your pull request and welcome to our community. We require contributors to sign our Contributor License Agreement, and we don\'t seem to have you on file. In order for us to review and merge your code, please contact the project maintainers to get yourself added.';

exports.handler = (event, context, callback, request) => {
  // TODO: log callback invocations
  if (event.body.action !== 'opened') {
    callback(null, {'message': 'ignored action of type ' + event.body.action});
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

  const user = event.body.pull_request.user.login;
  const issueUrl = event.body.pull_request.issue_url;

  githubRequest({
    url: event.body.repository.url + '/contents/.clabot',
    method: 'GET'
  })
  .then(body => githubRequest({
    url: body.download_url,
    method: 'GET'
  }))
  .then(body => {

    const userToken = privateKey.decrypt(body.token, 'base64', 'utf8');
    const label = body.label || 'cla-signed';
    const message = body.message || defaultMessage;
    const statusUrl = event.body.repository.url + '/statuses/' + event.body.pull_request.head.sha;

    if (body.contributors.indexOf(user) !== -1) {
      console.log(`CLA approved for ${user} - adding label ${label} to ${issueUrl}`);
      // TODO: what if the label doesn't exists?
      return githubRequest({
        url: issueUrl + '/labels',
        body: [label]
      }, userToken)
      .then(body => githubRequest({
        url: statusUrl,
        body: {
          state: 'success',
          context: 'verification/cla-signed'
        }
      }, userToken))
      .then(() => callback(null, {'message': `added label ${label} to ${issueUrl}`}));
    } else {
      console.log(`CLA not found for ${user} - adding a comment to ${issueUrl}`);
      return githubRequest({
        url: issueUrl + '/comments',
        body: {body: message}
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
