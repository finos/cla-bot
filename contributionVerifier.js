const requestp = require('./requestAsPromise');
const { githubRequest, getFile } = require('./githubApi');

const contributorArrayVerifier = contributors =>
  committers =>
    Promise.resolve(committers.filter(c => contributors.indexOf(c) === -1));

const configFileFromGithubUrlVerifier = contributorListGithubUrl =>
  (committers, clabotToken) =>
    githubRequest({
      url: contributorListGithubUrl,
      method: 'GET'
    }, clabotToken)
    .then(body => githubRequest(getFile(body), clabotToken))
    .then(contributors => contributorArrayVerifier(contributors)(committers));

const configFileFromUrlVerifier = contributorListUrl =>
  committers =>
    requestp({
      url: contributorListUrl,
      json: true
    })
    .then(contributors => contributorArrayVerifier(contributors)(committers));

const webhookVerifier = webhookUrl =>
  committers =>
    Promise.all(committers.map(username =>
      requestp({
        url: webhookUrl,
        qs: {
          checkContributor: username
        }
      })
      .then(response => ({
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
    console.info('INFO', 'Checking contributors against the list supplied in the .clabot file');
    return contributorArrayVerifier(config.contributors);
  } else if (config.contributorListGithubUrl) {
    console.info('INFO', 'Checking contributors against the github URL supplied in the .clabot file');
    return configFileFromGithubUrlVerifier(config.contributorListGithubUrl);
  } else if (config.contributorListUrl) {
    console.info('INFO', 'Checking contributors against the URL supplied in the .clabot file');
    return configFileFromUrlVerifier(config.contributorListUrl);
  } else if (config.contributorWebhook) {
    console.info('INFO', 'Checking contributors against the webhook supplied in the .clabot file');
    return webhookVerifier(config.contributorWebhook);
  }
  throw new Error('A mechanism for verifying contributors has not been specified');
};
