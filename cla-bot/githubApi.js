const handlebars = require('handlebars');
const requestp = require('./requestAsPromise');
const gh = require('parse-github-url');

const getOrgConfigUrl = (repositoryUrl) => {
  const ghData = gh(repositoryUrl);
  const ghUrl = `https://${ghData.host}/repos/${ghData.owner}/clabot-config/contents/.clabot`;
  return ghUrl;
};

exports.githubRequest = (opts, token, method = 'POST') =>
    requestp(Object.assign({}, {
      json: true,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'github-cla-bot'
      },
      method
    }, opts));

exports.getOrgConfig = ({ webhook }) => ({
  url: getOrgConfigUrl(webhook.repository.url),
  method: 'GET'
});

exports.getReadmeUrl = ({ webhook }) => ({
  url: `${webhook.repository.url}/contents/.clabot`,
  method: 'GET'
});

exports.getFile = body => ({
  url: body.download_url,
  method: 'GET'
});

exports.addLabel = ({ gitHubUrls, config }) => ({
  url: `${gitHubUrls.issue}/labels`,
  body: [config.label]
});

exports.getLabels = ({ gitHubUrls }) => ({
  url: `${gitHubUrls.issue}/labels`
});

exports.deleteLabel = ({ gitHubUrls, config }) => ({
  url: `${gitHubUrls.issue}/labels`,
  body: [config.label],
  method: 'DELETE'
});

exports.getCommits = ({ gitHubUrls }) => ({
  url: `${gitHubUrls.pullRequest}/commits`,
  method: 'GET'
});

exports.setStatus = ({ webhook, gitHubUrls, correlationKey, headSha }, state) => ({
  url: `${webhook.repository.url}/statuses/${headSha}`,
  body: {
    state,
    context: 'verification/cla-signed',
    target_url: `${process.env.LOG_URL}?correlationKey=${correlationKey}`
  }
});

exports.addRecheckComment = ({ gitHubUrls, config }) => ({
  url: `${gitHubUrls.issue}/comments`,
  body: {
    body: config.recheckComment
  }
});

exports.addCommentNoCLA = ({ gitHubUrls, config }, usersWithoutCLA) => {
  const template = handlebars.compile(config.message);
  const message = template({ usersWithoutCLA });
  return ({
    url: `${gitHubUrls.issue}/comments`,
    body: {
      body: message
    }
  });
};

exports.addCommentNoEmail = ({ gitHubUrls, config }, unidentifiedUsers) => {
  const template = handlebars.compile(config.messageMissingEmail);
  const message = template({ unidentifiedUsers });
  return ({
    url: `${gitHubUrls.issue}/comments`,
    body: {
      body: message
    }
  });
};
