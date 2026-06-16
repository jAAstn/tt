import  { gsChrome }              from './gsChrome.js';
import  { gsStorage }             from './gsStorage.js';
import  { gsTabQueue }            from './gsTabQueue.js';
import  { gsTabSuspendManager }   from './gsTabSuspendManager.js';
import  { gsUtils }               from './gsUtils.js';
import  { tgs }                   from './tgs.js';

export const gsTabDiscardManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_DISCARDS = 5;
  const DEFAULT_DISCARD_TIMEOUT = 5 * 1000;

  const QUEUE_ID = '_discardQueue';

  // FIX 1: Die queueProps werden jetzt im Modul-Scope definiert.
  const queueProps = {
    concurrentExecutors: DEFAULT_CONCURRENT_DISCARDS,
    jobTimeout: DEFAULT_DISCARD_TIMEOUT,
    executorFn: performDiscard,
    exceptionFn: handleDiscardException,
  };
  
  // FIX 2: _discardQueue wird sofort und synchron initialisiert. 
  // Dadurch ist es garantiert definiert, wenn es später aufgerufen wird.
  let _discardQueue = gsTabQueue.init(QUEUE_ID, queueProps);

  // FIX 3: initAsPromised ist jetzt nur noch ein Wrapper, der die erfolgreiche 
  // Initialisierung signalisiert, da die eigentliche Initialisierung bereits erfolgt ist.
  function initAsPromised() {
    return new Promise(resolve => {
      gsUtils.log(QUEUE_ID, 'init successful');
      resolve();
    });
  }

  function queueTabForDiscard(tab, executionProps, processingDelay) {
    queueTabForDiscardAsPromise(tab, executionProps, processingDelay).catch(
      e => {
        gsUtils.log(tab.id, QUEUE_ID, e);
      }
    );
  }

function queueTabForDiscardAsPromise(tab, executionProps, processingDelay) {
    if (!_discardQueue) {
      gsUtils.warning(tab.id, QUEUE_ID, 'Discard queue not initialised, skipping');
      return Promise.resolve(false);
    }
    
    gsUtils.log(tab.id, QUEUE_ID, `Queueing tab for discarding.`);
    executionProps = executionProps || {};   
    return _discardQueue.queueTabAsPromise( tab, executionProps, processingDelay );
  }

  // This is called remotely by the _discardQueue
  // So we must first re-fetch the tab in case it has changed
  async function performDiscard(tab, executionProps, resolve, reject, requeue) {
    let _tab = null;
    try {
      _tab = await gsChrome.tabsGet(tab.id);
    } catch (error) {
      // assume tab has been discarded
    }
    if (!_tab) {
      gsUtils.warning( tab.id, QUEUE_ID, `Failed to discard tab. Tab may have already been discarded or removed.` );
      resolve(false);
      return;
    }
    tab = _tab;

    if (gsUtils.isSuspendedTab(tab) && tab.status === 'loading') {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab is still loading');
      requeue();
      return;
    }
    if (await tgs.isCurrentActiveTab(tab)) {
      const discardInPlaceOfSuspend = await gsStorage.getOption(gsStorage.DISCARD_IN_PLACE_OF_SUSPEND);
      if (!discardInPlaceOfSuspend) {
        gsUtils.log(tab.id, QUEUE_ID, 'Tab is active. Aborting discard.');
        resolve(false);
        return;
      }
    }
    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab already discarded');
      resolve(false);
      return;
    }
    gsUtils.log(tab.id, QUEUE_ID, 'Forcing discarding of tab.');
    
    // FIX 4: Verwendung der sicheren discard-Funktion
    await gsUtils.discardTabSafely(tab.id);
    
    resolve(true);
  }

  function handleDiscardException( tab, executionProps, exceptionType, resolve, reject, requeue ) {
    gsUtils.warning( tab.id, QUEUE_ID, `Failed to discard tab: ${exceptionType}` );
    resolve(false);
  }

  async function handleDiscardedUnsuspendedTab(tab) {
    if (
      await gsUtils.shouldSuspendDiscardedTabs() &&
      await gsTabSuspendManager.checkTabEligibilityForSuspension(tab, 3)
    ) {
      await tgs.setTabStatePropForTabId(tab.id, tgs.STATE_SUSPEND_REASON, 3);
      const suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
      gsUtils.log(tab.id, QUEUE_ID, 'Suspending discarded unsuspended tab');

      // Note: This bypasses the suspension tab queue and also prevents screenshots from being taken
      await gsTabSuspendManager.executeTabSuspension(tab, suspendedUrl, false, false, true);
    }
  }

function unqueueTabForDiscard(tab) {
    _discardQueue.unqueueTab(tab);
  }

  return {
    initAsPromised,
    queueTabForDiscard,
    queueTabForDiscardAsPromise,
    // EXPORTIEREN SIE DIE FUNKTION HIER
    unqueueTabForDiscard,
    handleDiscardedUnsuspendedTab,
    getQueuedTabDetails: () => _discardQueue.getQueuedTabDetails(),
    queueId: QUEUE_ID,
  };
})();