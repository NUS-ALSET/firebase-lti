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

Then run a local server (it only run a local hosting server, the app still need
remote access to the Firebase server):
```shell
firebase serve
```


## Deployment

Make sure you targeting the expecting Firebase project using `firebase use` and
then deploy:

```shell
firebase use
firebase deploy
```

The LTI plugin is now serving.


## Installation

### moodlecloud

- TODO
