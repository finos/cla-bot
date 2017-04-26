const label = 'cla-signed';

const usersWithCla = [
  'ColinEberhardt',
  'BenLambertNcl',
  'jleft',
  'JohnEz'
];

const message = 'Thank you for your pull request and welcome to our community. We require contributors to sign our Contributor License Agreement, and we don\'t seem to have you on file. In order for us to review and merge your code, please contact @ColinEberhardt to find out how to get yourself added.';

exports.handler = (event, context, callback, request) => {
  // TODO: log callback invocations

  // for test purposes we pass in a mocked request object
  request = request || require('request');

  // adapts the request API to provide generic handling of HTTP / transport errors and
  // error responses from the GitHub API.
  const githubRequest = (opts, cb) => {
    // merge the standard set of HTTP request options
    const mergedOptions = Object.assign({}, {
      json: true,
      headers: {
        'Authorization': 'token ' + process.env.GITHUB_ACCESS_TOKEN,
        'User-Agent': 'github-cla-bot'
      },
      method: 'POST'
    }, opts);

    // perform the request
    request(mergedOptions, (error, response, body) => {
      if (error) {
        callback(error.toString());
      } else if (response && response.statusCode && response.statusCode !== 200) {
        callback(null, {'message': 'GitHub API request failed', statusCode: response.statusCode, body});
      } else {
        cb();
      }
    });
  };

  if (event.body.action !== 'opened') {
    callback(null, {'message': 'ignored action of type ' + event.body.action});
  } else {
    const user = event.body.pull_request.user.login;
    const issueUrl = event.body.pull_request.issue_url;

    if (usersWithCla.indexOf(user) !== -1) {
      console.log(`CLA approved for ${user} - adding label ${label} to ${issueUrl}`);
      // TODO: what if the label doesn't exists?
      githubRequest({
        url: issueUrl + '/labels',
        body: [label]
      },
      () => {
        callback(null, {'message': `added label ${label} to ${issueUrl}`});
      });
    } else {
      console.log(`CLA not found for ${user} - adding a comment to ${issueUrl}`);
      githubRequest({
        url: issueUrl + '/comments',
        body: {body: message}
      },
      () => {
        callback(null, {'message': `CLA has not been signed by ${user}, added a comment to ${issueUrl}`});
      });
    }
  }
};
