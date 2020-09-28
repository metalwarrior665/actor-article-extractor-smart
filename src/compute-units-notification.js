const Apify = require('apify');

const { log } = Apify.utils;

const sendMail = async (CUs, limit, notificationEmails, runId) => {
    const actorInput = {
        to: notificationEmails.join(','),
        subject: `Article extractor ${runId} reached ${CUs}`,
        text: `Article extractor ${runId} reached ${CUs} which is more than notification limit ${limit}`,
    };
    await Apify.call('apify/send-mail', actorInput, { waitSecs: 0 });
};

module.exports = async (stopAfterCUs, notifyAfterCUs, notificationEmails, notifyAfterCUsPeriodically, notificationState) => {
    log.info('NOTIFICATIONS --- Checking if to send notifications...');
    const { actorId, actorRunId } = Apify.getEnv();
    const { stats } = await Apify.client.acts.getRun({ actId: actorId, runId: actorRunId });
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
