const Apify = require('apify');

const client = Apify.newClient();

const { log } = Apify.utils;

const sendMail = async (CUs, limit, notificationEmails, runId) => {
    const actorInput = {
        to: notificationEmails.join(','),
        subject: `Article extractor ${runId} reached ${CUs}`,
        text: `Article extractor ${runId} reached ${CUs} which is more than notification limit ${limit}`,
    };
    await client.actor('apify/send-mail').call(actorInput, { waitSecs: 0 });
};

const CUNotification = async (stopAfterCUs, notifyAfterCUs, notificationEmails, notifyAfterCUsPeriodically, notificationState) => {
    log.info('NOTIFICATIONS --- Checking if to send notifications...');
    const { actorRunId } = Apify.getEnv();
    const { stats } = await client.run(actorRunId).get();
    const CUs = stats.computeUnits;
    if (notifyAfterCUsPeriodically) {
        const { next } = notificationState;
        if (CUs >= next) {
            log.warning(`NOTIFICATIONS --- Actor reached ${CUs} which is more than notifyAfterCUsPeriodically: ${next}. Sending notification email`);
            await sendMail(CUs, next, notificationEmails, actorRunId);
            notificationState.next += notifyAfterCUsPeriodically;
            await Apify.setValue('NOTIFICATION-STATE', notificationState);
        }
    }
    if (!notificationState.wasNotified && notifyAfterCUs && CUs >= notifyAfterCUs) {
        log.warning(`NOTIFICATIONS --- Actor reached ${CUs} which is more than notifyAfterCUs: ${notifyAfterCUs}. Sending notification email`);
        await sendMail(CUs, notifyAfterCUs, notificationEmails, actorRunId);
        notificationState.wasNotified = true;
        await Apify.setValue('NOTIFICATION-STATE', notificationState);
    }
    if (stopAfterCUs && CUs >= stopAfterCUs) {
        log.warning(`NOTIFICATIONS --- Actor reached ${CUs} which is more than stopAfterCUs: ${stopAfterCUs}. Exiting actor.`);
        process.exit(0);
    }
};

// Special functionality for J.S.
module.exports.setupNotifications = async ({
    notifyAfterCUsPeriodically,
    stopAfterCUs,
    notifyAfterCUs,
    notificationEmails,
}) => {
    const defaultNotificationState = {
        next: notifyAfterCUsPeriodically,
        wasNotified: false,
    };

    const notificationState = (await Apify.getValue('NOTIFICATION-STATE'))
        || defaultNotificationState;

    // Measure CUs every 30 secs if enabled in input
    if (stopAfterCUs || notifyAfterCUs || notifyAfterCUsPeriodically) {
        if (Apify.isAtHome()) {
            setInterval(async () => {
                await CUNotification(stopAfterCUs, notifyAfterCUs, notificationEmails, notifyAfterCUsPeriodically, notificationState);
            }, 30000);
        } else {
            log.warning('Cannot measure Compute units of local run. Notifications disabled...');
        }
    }
};
