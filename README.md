# cla-bot

cla-bot is a GitHub bot for automation of Contributor Licence Agreements (CLAs). It checks whether contributors have signed an agreement, adding labels to PRs if they have, or prompting for signature if they have not.

## Status

This project is very much a work-in-progress, so is not intended for production use just yet! However, as you can see from the roadmap below, it's not far off MVP.


## Installing cla-bot

*This documentation is not complete, but gives a good idea of where this project is heading*

In order to use cla-bot, you need to enable the GitHub App for your personal projects, or an organisation. Visit https://github.com/apps/cla-bot, click 'Install', and select the project that you want to enable cla-bot on. Once enabled, cla-bot will be informed whenever a pull request is opened or updated on any of the selected repositories.

When a pull request opened, cla-bot checks all the committers to ensure that they have a signed CLA. In order for cla-bot to perform this check you need to add a `.clabot` file to your repository.

The `.clabot` will be automatically resolved in the root project folder (for example, `https://github.com/foo/bar/blob/master/.clabot`), or in a Github repository called `clabot-config` that exists in the same user/organisation (for example, `https://github.com/foo/clabot-config/blob/master/.clabot`); the latter takes precedence.

There are three possible configurations:

### Embedded contributor list

You can embed the contributors directly into the `.clabot` file as an array of GitHub usernames:

```
{
  "contributors": [ "frank", "bob", "sam" ]
}
```

### Via URL

You can define the URL to resolve the contributors list as an array of Github usernames (JSON format):  an http(s) URL that is loaded at each PRwebhook which is invoked for each committer:

```
{
  "contributors: "http://foo.com/static/contributors"
}
```

You can also point to a GitHub hosted file, including private repositories (as it will use `GITHUB_ACCESS_TOKEN`, see below):

```
{
  "contributors": "https://api.github.com/repos/foo/bar/contents/.contributors",
}
```

### Via a webhook

You can supply a webhook which is invoked for each committer:

```
{
  "contributors: "http://foo.com/contributor?checkContributor="
}
```

With each invocation, the `checkContributor` querystring parameter is used to supply the committer username. The webhook should return a JSON response that indicates whether the committer has signed a CLA:

```
{
  isContributor: true
}
```

### Adding a custom message

If you wish to add a custom message, include a `message` property within the `.cla-bot` file. This can optionally include a `{{usersWithoutCLA}}` token which is expanded out to the names of the contributors who have not signed a CLA.

For example:

```
{
  "contributors": [ "frank", "bob", "sam" ],
  "message": "We require contributors to sign our Contributor License Agreement, and we don\"t have {{usersWithoutCLA}} on file. In order for us to review and merge your code, please contact @FriendlyAdmin to get yourself added."
}
```

It is good practice to include details of who to contact in order to go ahead with the CLA signing process.

### Adding a custom label

If a PR is opened where all the contributors have signed the CLA, it is labelled with `cla-signed`. You can configure this behaviour as follows:

```
{
  "label": "my-custom-label"
}
```

## Development

You know ... the usual ...

~~~
npm install
~~~

### Running locally

For most end users cla-bot will be added to a project as an integration, this provides the simplest integration experience. However, this is also the most complex from a set-up perspective! In order to simplify things, in development, you can run the bot as a simple webhook integration.

1. Create a [personal access token](https://github.com/settings/tokens) for the account that you want to run the bot as.
2. Edit `deploy.env.example`, renaming to `deploy.env`, and add the personal access token generated above to `GITHUB_ACCESS_TOKEN`.
3. Ensure `INTEGRATION_ENABLED` is set to false.
4. Find a suitable repo to test against, and add a `.clabot` file.
5. The `event.json` provides an example webhook (with most of the fields removed) that the bot receives when a PR is opened. Edit this file so that it points to a PR in your test repository.
6. The bot comments, adds labels, and updates the status of commits. In order to do this it needs write access to the repo. Note that the integration only requests the minimal permissions required to perform these functions. Either the repo you are using to test against in (4) needs to be owned by the user from (1), or you need to add the user as a collaborator or team member.
7. You're ready to go!!!

Run the bot as follows:

```
$ npm run execute  
```

If everything goes to plan, you'll see the HTTP requests logged as follows:

```
Checking CLAs for PR https://api.github.com/repos/ColinEberhardt/clabot-test/pulls/14
API Request https://api.github.com/repos/ColinEberhardt/clabot-test/contents/.clabot {}
API Request https://raw.githubusercontent.com/ColinEberhardt/clabot-test/master/.clabot {}
API Request https://api.github.com/repos/ColinEberhardt/clabot-test/pulls/14/commits {}
API Request https://raw.githubusercontent.com/ColinEberhardt/clabot-test/master/.contributors {}
API Request https://api.github.com/repos/ColinEberhardt/clabot-test/issues/14/labels [ 'cla-signed' ]
API Request https://api.github.com/repos/ColinEberhardt/clabot-test/statuses/462eecdd0d4c822e64dafc774974f21e91ddd305 { state: 'success', context: 'verification/cla-signed' }
callback null { message: 'added label cla-signed to https://api.github.com/repos/ColinEberhardt/clabot-test/pulls/14' }
Success:
{"message":"added label cla-signed to https://api.github.com/repos/ColinEberhardt/clabot-test/pulls/14"}
```

Magic! You can now play around with adding / removing contributors, checking that the bot functions correctly.

### Deploying as a webhook

This bot is hosted on AWS, with the deployment managed via the `.travis.yml` file. This uses the AWS tokens for my account, which are encrypted by travis so will of course not work on your fork!

If you want to deploy to your own AWS, you'll either have to update this file with your own credentials, or, for ad-hoc deployment you can use the following:

```
npm run deploy
```

This uses [node-lambda](https://github.com/motdotla/node-lambda) for deployment. You'll have to add your AWS access key and secret to a `.env` file as per the node-lambda instructions. This method of deployment also sets up the lambda environment variables as defined in `deploy.env`. With travis, you have to add environment variables manually.

Once deployed, you'll also need to set up an API Gateway to allow HTTP access to your lambda. Good luck with that, it's a barrel of laughs!

### Deploying as an integration

TODO!
