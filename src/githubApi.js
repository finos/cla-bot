const handlebars = require("handlebars");
const requestp = require("./requestAsPromise");
const gh = require("parse-github-url");

const getOrgConfigUrl = repositoryUrl => {
  const ghData = gh(repositoryUrl);
  const ghUrl = `https://${ghData.host}/repos/${
    ghData.owner
  }/clabot-config/contents/.clabot`;
  return ghUrl;
};

exports.githubRequest = (opts, token, method = "POST") =>
  requestp(
    Object.assign(
      {},
      {
        json: true,
        headers: {
          Authorization: `token ${token}`,
          "User-Agent": "github-cla-bot"
        },
        method
      },
      opts
    )
  );

exports.getOrgConfig = webhook => ({
  url: getOrgConfigUrl(webhook.repository.url),
  method: "GET"
});

exports.getReadmeUrl = webhook => ({
  url: `${webhook.repository.url}/contents/.clabot`,
  method: "GET"
});

exports.getFile = body => ({
  url: body.download_url,
  method: "GET"
});

exports.addLabel = (issueUrl, label) => ({
  url: `${issueUrl}/labels`,
  body: [label]
});

exports.getLabels = issueUrl => ({
  url: `${issueUrl}/labels`,
  method: "GET"
});

exports.deleteLabel = (issueUrl, label) => ({
  url: `${issueUrl}/labels`,
  body: [label],
  method: "DELETE"
});

exports.getCommits = pullRequestUrl => ({
  url: `${pullRequestUrl}/commits`,
  method: "GET"
});

exports.setStatus = (webhook, headSha, state, target_url) => ({
  url: `${webhook.repository.url}/statuses/${headSha}`,
  body: {
    state,
    context: "verification/cla-signed",
    target_url
  }
});

exports.addRecheckComment = (issueUrl, recheckComment) => ({
  url: `${issueUrl}/comments`,
  body: {
    body: recheckComment
  }
});

exports.addCommentNoCLA = (issueUrl, message, usersWithoutCLA) => {
  // TODO: move this logic out of this file
  const template = handlebars.compile(message);
  return {
    url: `${issueUrl}/comments`,
    body: {
      body: template({ usersWithoutCLA })
    }
  };
};

exports.addCommentUnidentified = (issueUrl, message, unidentifiedUsers) => {
  const template = handlebars.compile(message);
  return {
    url: `${issueUrl}/comments`,
    body: {
      body: template({ unidentifiedUsers })
    }
  };
};
