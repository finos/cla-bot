const requestp = require("./requestAsPromise");
const is = require("is_js");
const { githubRequest, getFile } = require("./githubApi");

// return the list of committers who are not know contributors
const contributorArrayVerifier = contributors => committers => {
  const emailVerification = contributors
    .filter(c => c.includes("@"))
    .map(c => c.toLowerCase());
  const usernameVerification = contributors
    .filter(c => !c.includes("@"))
    .map(c => c.toLowerCase());

  const isValidContributor = c => {
    if (c.email && emailVerification.includes(c.email.toLowerCase())) {
      return true;
    }
    if (usernameVerification.includes(c.login.toLowerCase())) {
      return true;
    }
    return false;
  };

  const res = committers.filter(c => !isValidContributor(c)).map(c => c.login);
  return Promise.resolve(res);
};

const configFileFromGithubUrlVerifier = contributorListGithubUrl => (
  committers,
  clabotToken
) =>
  githubRequest(
    {
      url: contributorListGithubUrl,
      method: "GET"
    },
    clabotToken
  )
    .then(body => githubRequest(getFile(body), clabotToken))
    .then(contributors => contributorArrayVerifier(contributors)(committers));

const configFileFromUrlVerifier = contributorListUrl => committers =>
  requestp({
    url: contributorListUrl,
    json: true
  }).then(contributors => contributorArrayVerifier(contributors)(committers));

const webhookVerifier = webhookUrl => committers =>
  Promise.all(
    committers.map(committer =>
      requestp({
        url: webhookUrl + committer.login,
        json: true
      }).then(response => ({
        username: committer.login,
        isContributor: response.isContributor
      }))
    )
  ).then(responses => {
    const contributors = responses
      .filter(r => r.isContributor)
      .map(r => r.username);
    return contributorArrayVerifier(contributors)(committers);
  });

module.exports = config => {
  const configCopy = Object.assign({}, config);

  // handle the 'legacy' configuration where each type had its own propery
  if (configCopy.contributorListGithubUrl) {
    configCopy.contributors = configCopy.contributorListGithubUrl;
  } else if (config.contributorListUrl) {
    configCopy.contributors = configCopy.contributorListUrl;
  } else if (config.contributorWebhook) {
    configCopy.contributors = configCopy.contributorWebhook;
  }

  if (configCopy.contributors) {
    if (is.array(configCopy.contributors)) {
      console.info(
        "INFO",
        "Checking contributors against the list supplied in the .clabot file"
      );
      return contributorArrayVerifier(configCopy.contributors);
    } else if (
      is.url(configCopy.contributors) &&
      configCopy.contributors.indexOf("api.github.com") !== -1
    ) {
      console.info(
        "INFO",
        "Checking contributors against the github URL supplied in the .clabot file"
      );
      return configFileFromGithubUrlVerifier(configCopy.contributors);
    } else if (
      is.url(configCopy.contributors) &&
      configCopy.contributors.indexOf("?") !== -1
    ) {
      console.info(
        "INFO",
        "Checking contributors against the webhook supplied in the .clabot file"
      );
      return webhookVerifier(configCopy.contributors);
    } else if (is.url(configCopy.contributors)) {
      console.info(
        "INFO",
        "Checking contributors against the URL supplied in the .clabot file"
      );
      return configFileFromUrlVerifier(configCopy.contributors);
    }
  }
  throw new Error(
    "A mechanism for verifying contributors has not been specified"
  );
};
