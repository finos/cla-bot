# FINOS cla-bot deploy

1. Check environment setup in `src/serverless.env.yml` (`staging` and `prod`)
2. Run NPM
```
npm install
npm audit fix --force
```
3. Deploy
```
serverless deploy --stage staging
```