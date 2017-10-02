# firebase-lti

A reference Firebase LTI-provider application.

## Development

In a terminal, install node dependencies:
```shell
npm install
npm install -g firebase-tools firebase-bolt
```

If you don't have Firebase project setup, head to the [Firebase console]
and create one. Then in a terminal, set this project with firebase-tools:
```shell
firebase use
```

You also need to create a service account for this project and save the json
service account details at `./functions/<project-id>-service-account.json`.

Then run a local server (it only run a local hosting server, the app still need
remote access to the Firebase server):
```shell
npm run deploy-rules
npm run deploy-triggers
DEBUG=* npm start
```


## Deployment

Make sure you targeting the expecting Firebase project using `firebase use` and
then deploy:

```shell
firebase use
firebase deploy
```

The LTI plugin is now serving.

To send outcome request, you need to run a local scripts:
```shell
npm run send-outcome
```

TODO:

- describe out to deploy script.
- provide cloud-functions to process outcome request on Blaze plan.


## Installation

### moodlecloud

- TODO
