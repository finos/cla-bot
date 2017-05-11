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
