import { MongoDB } from './database/index.mjs';
import { Mailer, TEST_SMTP_HOST } from './mail.mjs';

export const TEST_DB_NAME = 'test';

export const TEST_EMAIL_MESSAGES = {
    app: {
        name: 'Test App',
        baseURL: 'https://example.com',
    },
    game: {
        type: 'test games',
    },
    player: {
        emailUpdated: {
            salutation: 'Happy gaming!',
        },
        registered: {
            salutation: 'Thanks for playing with us!',
        },
        retrieved: {
            salutation: 'Take care and see you soon!',
        },
    },
    room: {
        requestApproved: {
            salutation: 'Have fun playing games with your friends!',
        },
    },
    signature: {
        admin: '\nYours,\nTest App Bot\n',
        default: '\nBest,\nTest App Bot\n',
    },
};

export async function getTestDB() {
    const config = {
        db: {
            name: TEST_DB_NAME,
            url: global.__MONGO_URI__,
        },
    };
    const db = new MongoDB(config);
    await db.init();
    return db;
}

export function getTestMailer() {
    const config = {
        admin: {},
        smtp: {host: TEST_SMTP_HOST},
        messages: {email: TEST_EMAIL_MESSAGES},
    };
    return new Mailer(config);
}
