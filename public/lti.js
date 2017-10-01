/* global firebase */
(function () {
  'use strict';

  const noop = () => {};

  /**
   * Launch log user on, set her solution and watch for grade changes.
   */
  class Launch {

    constructor({domain, resourceLinkId, token, onAuth = noop, onLoad = noop, onGrade = noop}) {
      this.domain = domain;
      this.resourceLinkId = resourceLinkId;
      this.token = token;
      this.onAuth = onAuth;
      this.onLoad = onLoad;
      this.onGrade = onGrade;

      this.grade = null;
      this._watches = {
        auth: noop,
        grade: noop
      };

      this.start();
    }

    /**
     * Log user in and start for changes to her grade and login status.
     */
    start() {
      const auth = firebase.auth();

      this.stop();

      this._watches.auth = auth.onAuthStateChanged(user => {
        if (user == null) {
          this.stop('grade');
        } else {
          this.watchGrade();
        }

        this.onAuth(user);
      });

      this.authenticate().then(
        () => this.onLoad(),
        err => this.onLoad(err)
      );
    }

    /**
     * Stop listing to firebase events.
     *
     * @param {string|string[]} keys Listeners to stop
     */
    stop(keys = Object.keys(this._watches)) {
      [].concat(keys).forEach(k => {
        this._watches[k]();
        this._watches[k] = noop;
      });
    }

    /**
     * Return the current user UID.
     *
     * @returns {string|void}
     */
    get uid() {
      const user = firebase.auth().currentUser;

      return user == null ? null : user.uid;
    }

    /**
     * Authenticate the user with provided auth token.
     *
     * @returns {Promise<user>}
     */
    authenticate() {
      const auth = firebase.auth();

      return auth.setPersistence(firebase.auth.Auth.Persistence.NONE)
        .then(() => auth.signInWithCustomToken(this.token));
    }

    /**
     * Monitor the grade for the current user.
     */
    watchGrade() {
      const db = firebase.database();
      const ref = db.ref(`/provider/launches/${this.domain}/${this.resourceLinkId}/users/${this.uid}/grade`);

      const handler = ref.on('value', snapshot => {
        this.grade = snapshot.exists() ? snapshot.val() : 0;
        this.onGrade(this.grade);
      }, console.error);

      this._watches.grade = () => {
        ref.off('value', handler);
      };
    }

    /**
     * Update the solution for the user.
     *
     * @param {any} obj Solution to save
     * @returns {Promise<void>}
     */
    solution(obj) {
      const db = firebase.database();
      const ref = db.ref(`/provider/launches/${this.domain}/${this.resourceLinkId}/users/${this.uid}/solution`);

      return ref.set(obj);
    }

  }

  // Namespace
  window.LTI = window.LTI == null ? {} : window.LTI;
  window.LTI = Object.assign(window.LTI, {launch: opts => new Launch(opts)});
})();
