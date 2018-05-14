# Deployment instructions

## Deployment

In order to deploy cla-bot on AWS, please follow the steps below.

### Configure cla-bot-logs module

#### create `env` files

Within the `cla-bot-logs` sub-folder, create the following files.

`.env`:
```
AWS_ACCESS_KEY_ID=<AWS Access Key>
AWS_SECRET_ACCESS_KEY=<AWS Secret Key>
AWS_ROLE=arn:aws:iam::<AWS Account ID>:role/service-role/<AWS IAM Role Name>
AWS_REGION=us-east-1
AWS_HANDLER=index.handler
AWS_MEMORY_SIZE=128
AWS_TIMEOUT=300
AWS_RUNTIME=nodejs6.10
```

For each environment (in our case, we have `test`, `staging` and `prod`), create <environment>.env:

```
LOGGING_TABLE=clabot-log-<environment>
```

#### Run node-lambda deployment for cla-bot-logs module

```
cd ../cla-bot-logs
node-lambda deploy --configFile <environment>.env -n cla-bot-<environment>-logs
```

#### Grab the API URL

Access [your API Gateway console](https://console.aws.amazon.com/apigateway/) and - for each environment (in our case `test`, `staging` and `prod`):
- Navigate to `cla-bot-<environment>-logs`
- Browse Stages > `logs`
- Grab the `Invoke URL` (ie. `https://daizwll9hh.execute-api.us-east-1.amazonaws.com/logs?correlationKey=7426a407-9d58-48dc-bee7-2403f77ffd55`)

### Configure cla-bot module

#### create `env` files

Within the `cla-bot` sub-folder, create the following files.

`.env`:
```
AWS_ACCESS_KEY_ID=<AWS Access Key>
AWS_SECRET_ACCESS_KEY=<AWS Secret Key>
AWS_ROLE=arn:aws:iam::<AWS Account ID>:role/service-role/<AWS IAM Role Name>
AWS_REGION=us-east-1
AWS_HANDLER=index.handler
AWS_MEMORY_SIZE=128
AWS_TIMEOUT=300
AWS_RUNTIME=nodejs6.10
```

For each environment (in our case, we have `test`, `staging` and `prod`), create <environment>.env:

```
AWS_ENVIRONMENT=<environment>
GITHUB_ACCESS_TOKEN=<GitHub Token>
LOG_URL=<The env specific "Invoke URL" from the cla-bot-logs>
INTEGRATION_ENABLED=true
INTEGRATION_KEY=<GitHub App pem key>
INTEGRATION_ID=<GitHub App ID>
BOT_NAME=cla-bot-<environment>
LOGGING_TABLE=clabot-log-<environment>
```

#### Run node-lambda deployment for cla-bot module

```
node-lambda deploy --configFile <environment>.env -n cla-bot-<environment>-lambda
```

## AWS Configuration

### Create DynamoDB Table
- Name: same as `LOGGING_TABLE` defined in the `<environment>.env` file
- Primary key: `correlationKey`
- Check 'Add sort key' and set `time` as field value

### Create IAM user
- Access IAM service from AWS Dashboard
- On `Access Type`, check `Programmatic access`
- When done, save `Access key ID` as `AWS_ACCESS_KEY_ID` and `Secret Access key` as `AWS_SECRET_ACCESS_KEY`

### Create IAM role
- Choose `AWS Service Role`
- on `AWS Lambda` row, click on `Select`
- Select `AWSLambdaFullAccess` and `IAMFullAccess` and click on `Next Step`
- Set Role name as `cla-bot-role` and click on `Create role`
- Click on the newly created `cla-bot-role` and save `Role ARN` as `WS_ROLE_ARN`

### API Gateway
- Create API
  - Endpoint type: `Edge Optimized`
- Select `Resources` from the left menu, click on `Actions > Create Method`
- Choose `POST` as method and confirm
- Define `Lambda Region` field to match `<AWS_REGION>` (see step #6)
- Define `Lambda Function` field to match `<AWS_FUNCTION_NAME>-lambda` (see step #6)
- Click on Save; a dialog `Add Permission to Lambda Function` will show up, click on `Ok`
- Click on `Integration Request` and extend `Body Mapping Templates`
- Select `When there are no templates defined (recommended)` for field `Request body passthrough`
- Click on `Add mapping template`, type `application/json` for "Content-Type", confirm and paste the following content in the text area:
```
{
  "body" : $input.json('$'),
  "headers": {
    #foreach($header in $input.params().header.keySet())
    "$header": "$util.escapeJavaScript($input.params().header.get($header))" #if($foreach.hasNext),#end

    #end
  },
  "method": "$context.httpMethod",
  "params": {
    #foreach($param in $input.params().path.keySet())
    "$param": "$util.escapeJavaScript($input.params().path.get($param))" #if($foreach.hasNext),#end

    #end
  },
  "query": {
    #foreach($queryParam in $input.params().querystring.keySet())
    "$queryParam": "$util.escapeJavaScript($input.params().querystring.get($queryParam))" #if($foreach.hasNext),#end
    #end
  }  
}
```
- Click on `Save`
- Click on `Actions > Deploy API`
- Select `[New Stage]` as `Deployment Stage`
- Type `<AWS_ENVIRONMENT>` (see step #6) on `Stage name`
- Save the `Invoke URL` as API_URL

If you have problems invoking the Lambda function, check the [Lambda role configurations](https://github.com/awslabs/serverless-application-model/issues/59#issuecomment-296681182) and enable API Logging (via the API Stage Editor)

### Test
- Open [Postman](https://chrome.google.com/webstore/detail/postman/fhbjgbiflinjbdggehcddcbncdddomop?hl=en) (or similar)
- Set method to `POST`
- Set URL as `<API_URL>` (see step #8)
- Add header param `Content-type` with value `application/json`
- Send the request
- Check the response from Postman
- Check AWS Cloudwatch logs, see if they match

## GitHub Configuration

### Setup a Github App
- Log into Github.com
- Access https://github.com/settings/apps/new
- Set homepage URL to https://finos.github.io/cla-bot
- Set `User authorization callback URL` to `<API_URL>` (will be defined on step #5)
- Set `Webhook URL` to `<API_URL>` (will be defined on step #8)
- On Permissions:
  - `Commit statuses` set to `Read & write`
  - "Issues" set to `Read & write`
  - "Pull requests" set to `Read & write` and check `Pull Request` item
  - `Repository contents` set to `Read-only`
- On `Subscribe to Events`, check:
  - Status
  - Issue comment
  - Pull Request
- Set `Only on this account` to `Where can this GitHub App be installed?`
- Click on `Save`
- Click on `Generate Private Key` and download it locally
- Save `INTEGRATION_KEY` as the local path to the downloaded file, `INTEGRATION_ID` as the 4-digits number reported on the top right of the Github App screen and `BOT_NAME` as the name of the Github App

### Install the Github App
Click on the `Install` button (top-right of Github App page) and enable it only for the current account, only on one repository.

Important! Make sure that you also add `clabot-config` repository at org level, if you want to use the same configuration across all org repositories.

In the permissions tab, add all the items reported in the screenshot posted in [this gist comment](https://gist.github.com/maoo/16b4a683e8cf9ae4b466ace0ae745497#gistcomment-2146379)

### Create Github Personal Access Token
Follow [github docs](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/) and save the generated token as `GITHUB_ACCESS_TOKEN`; no scopes or permissions must be defined, all items must be unchecked.
