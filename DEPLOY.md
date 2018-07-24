# Deployment instructions

In order to deploy cla-bot on AWS, please follow the steps below.

## Configure cla-bot module

### create `env` files

Within the `cla-bot` sub-folder, rename `serverless.env.example.yml` to `serverless.env.yml` and fill in the required information for each of the stages you want to construct.

Please note that - if `GITHUB_ACCESS_TOKEN` is defined, `INTEGRATION_ENABLED` MUST be set to `false` (otherwise the GitHub Access Token will not be used and the cla-bot will fail accessing clabot-config, if private)


## Serverless

The cla-bot uses the serverless framework to manage the deployment of lambda functions, AWS gateway etc ...

You can deploy the stack for a given stage as follows:

```
serverless deploy --stage dev
```

## GitHub Configuration

### Setup a Github App
- Log into Github.com
- Access https://github.com/settings/apps/new
- Set homepage URL to https://colineberhardt.github.io/cla-bot
- Set `User authorization callback URL` and `Webhook URL` to `http://google.com`; you'll change it later on, as soon as the APIs are properly configured
- Set `Homepage URL` to `https://colineberhardt.github.io/cla-bot`
- On Permissions:
  - `Repository contents` set to `Read-only`
  - `Issues` set to `Read & write`
  - `Pull requests` set to `Read & write`
  - `Commit statuses` set to `Read & write`
- On `Subscribe to Events`, check:
  - `Pull Request`
  - `Status`
  - `Issue comment`
- Set `Only on this account` to `Where can this GitHub App be installed?`
- Click on `Save`
- Click on `Generate Private Key` and download it locally
- Save `INTEGRATION_KEY` as the local path to the downloaded file, `INTEGRATION_ID` as the 4-digits number reported on the top right of the Github App screen and `BOT_NAME` as the name of the Github App

### Install the Github App
Click on the `Install` button (top-right of Github App page) and enable it only for the current account, only on one repository.

Important! Make sure that you also add `clabot-config` repository at org level, if you want to use the same configuration across all org repositories.

In the permissions tab, add all the items reported in the screenshot posted in [this gist comment](https://gist.github.com/maoo/16b4a683e8cf9ae4b466ace0ae745497#gistcomment-2146379)

### Create Github Personal Access Token
Follow [github docs](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/) and save the generated token as `GITHUB_ACCESS_TOKEN`; no scopes or permissions must be defined, all items must be unchecked; however, if you want to use a `clabot-config` private repository, you'd need to check `repo` (` Full control of private repositories`).
