const getOrgConfigUrl = (repositoryUrl) => {
  var gh = require('parse-github-url');
  ghData = gh(repositoryUrl);
  ghUrl = "https://" + ghData.host + "/repos/" + ghData.owner + "/clabot-config/contents/.clabot";
  console.log("clabot org URL - "+ghUrl);
  return ghUrl;
};

exports.getOrgConfig = ({webhook}) => ({
  url: getOrgConfigUrl(webhook.repository.url),
  method: 'GET'
});

exports.getReadmeUrl = ({webhook}) => ({
  url: webhook.repository.url + '/contents/.clabot',
  method: 'GET'
});

exports.getReadmeContents = (body) => ({
  url: body.download_url,
  method: 'GET'
});

exports.addLabel = ({webhook, config}) => ({
  url: webhook.pull_request.issue_url + '/labels',
  body: [config.label]
});

exports.deleteLabel = ({webhook, config}) => ({
  url: webhook.pull_request.issue_url + '/labels',
  body: [config.label],
  method: 'DELETE'
});

exports.getCommits = ({webhook}) => ({
  url: webhook.pull_request.url + '/commits',
  method: 'GET'
});

exports.setStatus = ({webhook}, state) => ({
  url: webhook.repository.url + '/statuses/' + webhook.pull_request.head.sha,
  body: {
    state,
    context: 'verification/cla-signed'
  }
});

exports.addComment = ({webhook, config}) => ({
  url: webhook.pull_request.issue_url + '/comments',
  body: {
    body: config.message
  }
});
