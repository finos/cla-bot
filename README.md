# cla-bot

cla-bot is a GitHub bot for automation of Contributor Licence Agreements (CLAs). It checks whether contributors have signed an agreement, adding labels to PRs if they have, or prompting for signature if they have not.

## Status

This project is very much a work-in-progress, so is not intended for production use just yet! It currently uses webhooks and requires that the github-cla-bot user is added as a contributor to your project. In the near future this should be changed to a GitHub integration.

## Roadmap

A bunch of things I'd like to do in order to make this an MVP.

  - [x] Verify the users for each commit rather than the user that created the PR
  - [x] Make the user whitelist configurable (it's hard-coded in `index.js` at the moment!)
  - [x] Allow users to add a `.clabot` file to their repo to provide configuration (this could fix the above)
  - [ ] Make the mechanism for checking that a user has signed a CLA configurable, e.g. the lambda could invoke a HTTP endpoint to check if a user has a signed CLA
  - [ ] Allow PRs to be re-checked after a user has signed a CLI (perhaps the bot could be 'pinged' via a comment?)
  - [ ] Turn this into a GitHub integration rather than a manually configured webhook
  - [x] Use the GitHub status API so that projects can add pre-merge checks for the CLA
  - [ ] Create a super-awesome website that makes CLAs look fun and cool!

## Development

~~~
npm install
~~~

### How it works

The cla-bot is integrated into a GitHub project via webhooks. When a pull request is opened the verification URL is invoked. The bot logic is hosted as an AWS Lambda function, which inspects the webhook payload to determine whether the user needs to sign a CLA or not. Following this the GitHub API is used to either add a label or comment to the pull request.

### Running locally

This project makes use of the `node-lambda` command line tool for running the code locally and managing AWS deployment. Before running the code you need to provide some environment variables, rename `.env.example` to `.env` and add the GitHub access token for the GitHub account that you are using to act as the bot.

The next step is to provide the test inputs to the lambda function. Edit `event.json` to provide some suitable test data.

Finally, execute the lambda function via `npm run execute`. Here's an example output:

~~~console
$ npm run execute

> cla-bot@1.0.0 execute /Users/colineberhardt/Projects/cla-bot
> node-lambda run --configFile deploy.env

CLA approved for ColinEberhardt - adding label bug to https://api.github.com/repos/ColinEberhardt/slabot-test/issues/5
Success:
{"message":"added label bug to https://api.github.com/repos/ColinEberhardt/slabot-test/issues/5"}
~~~

### Deploying

In order to deploy to AWS, rename `deploy.env.example` to `deploy.env` and add your AWS tokens. Following this, run `npm run deploy`.

For your function to be available via an HTTP endpoint, you'll also need to configure the AWS API Gateway. This involves a lot of form filling and mouse clicks. Enjoy.
