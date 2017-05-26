const requestp = require('./requestAsPromise');
const {githubRequest, getReadmeContents} = require('./githubApi');

const clabotToken = process.env.GITHUB_ACCESS_TOKEN;

const contributorArrayVerifier = (contributors) =>
  (committers) =>
    Promise.resolve(committers.filter(c => contributors.indexOf(c) === -1));

const configFileFromGithubUrlVerifier = (contributorListGithubUrl) =>
  (committers) =>
    githubRequest({
      url: contributorListGithubUrl,
      method: 'GET'
    }, clabotToken)
    .then((body) => githubRequest(getReadmeContents(body), clabotToken))
    .then((contributors) => contributorArrayVerifier(contributors)(committers));

const configFileFromUrlVerifier = (contributorListUrl) =>
  (committers) =>
    requestp({
      url: contributorListUrl,
      json: true
    })
    .then((contributors) => contributorArrayVerifier(contributors)(committers));

const webhookVerifier = (webhookUrl) =>
  (committers) =>
    Promise.all(committers.map(username =>
      requestp({
        url: webhookUrl,
        qs: {
          checkContributor: username
        }
      })
      .then((response) => ({
        username,
        isContributor: response.isContributor
      }))
    ))
    .then((responses) => {
      const contributors = responses.filter(r => r.isContributor)
        .map(r => r.username);
      return contributorArrayVerifier(contributors)(committers);
    });

module.exports = (config) => {
  if (config.contributors) {
    return contributorArrayVerifier(config.contributors);
  } else if (config.contributorListGithubUrl) {
    return configFileFromGithubUrlVerifier(config.contributorListGithubUrl);
  } else if (config.contributorListUrl) {
    return configFileFromUrlVerifier(config.contributorListUrl);
  } else if (config.contributorWebhook) {
    return webhookVerifier(config.contributorWebhook);
  }
};
