import { getSlackIdForSub, onWalletChange, type WalletEvent } from './db.ts';
import { dmUser } from './slack.ts';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n} Ω`;


export async function notifyWalletChange(e: WalletEvent) {
    if (e.delta === 0) return; // no-op
    const slackId = await getSlackIdForSub(e.sub);
    if (!slackId) return; // no Slack account to DM

    const headline = e.delta > 0
        ? `💰 *${signed(e.delta)}* landed in your Omega wallet.`
        : `🧾 *${signed(e.delta)}* left your Omega wallet.`;
    const why = e.reason ? `\n>${e.reason}` : '';
    await dmUser(slackId, `${headline}${why}\n\nNew balance: *${e.balance} Ω*`);
}

export function registerNotifiers(log: { error: (err: unknown, msg: string) => void }): void {
    onWalletChange((event) => {
        void notifyWalletChange(event).catch((err) => log.error(err, 'wallet DM failed'));
    });
}