const request = require('request');

const usersWithCla = [
  'ColinEberhardt',
  'BenLambertNcl',
  'jleft',
  'JohnEz'
];

const requestOptions = (url, body) =>
  Object.assign({}, {
    json: true,
    headers: {
      'Authorization': 'token ' + process.env.GITHUB_ACCESS_TOKEN
    }
  }, {
    url,
    body
  });

const message = 'Thank you for your pull request and welcome to our community. We require contributors to sign our Contributor License Agreement, and we don\'t seem to have you on file. In order for us to review and merge your code, please contact @ColinEberhardt to find out how to get yourself added.';

exports.handler = (event, context, callback) => {
  if (event.body.action !== 'opened') {
    callback(null, {'message': 'ignored action of type ' + event.body.action});
  } else {
    const user = event.body.pull_request.user.login;
    const issueUrl = event.body.pull_request.issue_url;

    if (usersWithCla.indexOf(user) !== -1) {
      request(requestOptions(issueUrl + '/labels', ['cla-signed']),
        (error, response, body) => {
          console.log(error, response, body);
          callback(null, {'message': 'label added'});
        });
    } else {
      request(requestOptions(issueUrl + '/comments', {body: message}),
        (error, response, body) => {
          console.log(error, response, body);
          callback(null, {'message': 'CLA not signed'});
        });
    }
  }
};
