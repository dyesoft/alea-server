import { Player, RoomLinkRequest } from '@dyesoft/alea-core';
import { describe, expect, jest, test } from '@jest/globals';
import {
    ADMIN_EMAIL_PLACEHOLDER,
    ADMIN_EMAIL_SIGNATURE_PLACEHOLDER,
    APP_BASE_URL_PLACEHOLDER,
    APP_NAME_PLACEHOLDER,
    DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER,
    EmailTemplates,
    Mailer,
    SMTP_PORT,
    TEST_SMTP_HOST,
} from './mail.mjs';
import { TEST_EMAIL_MESSAGES } from './testutils.mjs';

const TEST_ADMIN_EMAIL = 'admin@example.com';

const TEST_USER_NAME = 'Fred';
const TEST_USER_EMAIL = 'test@example.com';
const TEST_PLAYER = new Player(TEST_USER_NAME, TEST_USER_EMAIL);
TEST_PLAYER.playerID = TEST_USER_NAME.toLowerCase();

const TEST_ROOM_CODE = 'TEST';
const TEST_ROOM_LINK_REQUEST = new RoomLinkRequest(TEST_USER_NAME, TEST_USER_EMAIL);
TEST_ROOM_LINK_REQUEST.requestID = TEST_ROOM_CODE.toLowerCase();

const EXPECTED_PLAYER_EMAIL_UPDATED_EMAIL_BODY = `
Dear Fred,

We recently received a request to change the email address on your Test App account from this address to newfred@example.com. If you made this request, no further action is required.

If you did not make this request, please contact the administrator at admin@example.com to report potential abuse.

Happy gaming!

Best,
Test App Bot
`.trimStart();

const EXPECTED_PLAYER_REGISTERED_EMAIL_BODY = `
Dear Fred,

Thank you for registering your account with Test App! By registering with your email address, you will be able to restore your player account if you ever lose it in the future.

If you did not recently create an account at https://example.com, please contact the administrator at admin@example.com to report potential abuse.

Thanks for playing with us!

Best,
Test App Bot
`.trimStart();

const EXPECTED_PLAYER_RETRIEVAL_EMAIL_BODY = `
Dear Fred,

We recently received a request to restore your previous player account on Test App. If this was you, please use the link below to restore your account:

https://example.com?pid=fred

If you did not make this request, please contact the administrator at admin@example.com to report potential abuse.

Take care and see you soon!

Best,
Test App Bot
`.trimStart();

const EXPECTED_ROOM_CREATED_EMAIL_BODY = `
Dear Fred,

Your room TEST is now ready to go!

When you're ready, visit https://example.com/p/TEST to play unlimited test games with your friends!

This link will always be yours, so feel free to bookmark it, or send it to others so they can play with you.

Best,
Test App Bot
`.trimStart();

const EXPECTED_ROOM_REQUEST_APPROVED_EMAIL_BODY = `
Dear Fred,

Your request to create a new room in Test App has just been approved!

Please visit https://example.com?req=test and click "Create New Room" to create your room. If you have never played Test App before, you will have to create a player before you can create a room.

Once you have created your room, you can send the room code or a link to the room to your friends, and they can join your room and play with you.

Have fun playing games with your friends!

Best,
Test App Bot
`.trimStart();

const EXPECTED_ROOM_REQUEST_CREATED_EMAIL_BODY = `
A new Test App room link request has just been submitted by Fred (test@example.com).

Please visit https://example.com to approve or reject this request.

Yours,
Test App Bot
`.trimStart();

const TEST_CONFIG = {
    admin: {
        email: TEST_ADMIN_EMAIL,
    },
    messages: {
        email: TEST_EMAIL_MESSAGES,
    },
    smtp: {
        host: TEST_SMTP_HOST,
        fromAddress: '"Test App" <noreply@example.com>',
    },
};

const TEST_MAILER = new Mailer(TEST_CONFIG);

describe('EmailTemplates', () => {
    describe('apply', () => {
        describe('return type', () => {
            test('returns an object with keys `subject` and `body`', () => {
                const template = new EmailTemplates('', '');
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate).not.toBeNull();
                expect(appliedTemplate).toBeInstanceOf(Object);
                expect(appliedTemplate).toHaveProperty('subject');
                expect(appliedTemplate).toHaveProperty('body');
            });
        });

        describe('subject', () => {
            test('prepends app name in brackets to subject', () => {
                const template = new EmailTemplates('Test subject', '');
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.subject).toEqual('[Test App] Test subject');
            });

            test('substitutes app name for placeholder if present', () => {
                const template = new EmailTemplates(`Thank you for using ${APP_NAME_PLACEHOLDER}!`, '');
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.subject).toEqual('[Test App] Thank you for using Test App!');
            });
        });

        describe('body', () => {
            test('substitutes admin email for placeholder if present', () => {
                const template = new EmailTemplates('', `Contact ${ADMIN_EMAIL_PLACEHOLDER} with any questions.`);
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.body).toEqual('Contact admin@example.com with any questions.');
            });

            test('substitutes admin email signature for placeholder if present', () => {
                const template = new EmailTemplates('', `This is a message to the admin.\n${ADMIN_EMAIL_SIGNATURE_PLACEHOLDER}`);
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.body).toEqual('This is a message to the admin.\n\nYours,\nTest App Bot\n');
            });

            test('substitutes app base URL for placeholder if present', () => {
                const template = new EmailTemplates('', `Visit us at ${APP_BASE_URL_PLACEHOLDER}/about to learn more.`);
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.body).toEqual('Visit us at https://example.com/about to learn more.');
            });

            test('substitutes app name for placeholder if present', () => {
                const template = new EmailTemplates('', `Your account has been suspended on ${APP_NAME_PLACEHOLDER}.`);
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.body).toEqual('Your account has been suspended on Test App.');
            });

            test('substitutes default email signature for placeholder if present', () => {
                const template = new EmailTemplates('', `This is a message to a user.\n${DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER}`);
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.body).toEqual('This is a message to a user.\n\nBest,\nTest App Bot\n');
            });

            test('substitutes all placeholders as many times as needed', () => {
                const template = new EmailTemplates(
                    '',
                    (
                        `${APP_NAME_PLACEHOLDER} is located at ${APP_BASE_URL_PLACEHOLDER} and is owned by ${ADMIN_EMAIL_PLACEHOLDER}.\n` +
                        `Thank you for your interest in ${APP_NAME_PLACEHOLDER}! ${APP_NAME_PLACEHOLDER} wouldn't be the same without you.\n` +
                        `${DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER}`
                    )
                );
                const appliedTemplate = template.apply(TEST_MAILER);
                expect(appliedTemplate.body).toEqual((
                    'Test App is located at https://example.com and is owned by admin@example.com.\n' +
                    'Thank you for your interest in Test App! Test App wouldn\'t be the same without you.\n' +
                    '\nBest,\nTest App Bot\n'
                ));
            });
        });
    });
});

describe('Mailer', () => {
    describe('init', () => {
        test('creates transporter from SMTP config', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            expect(mailer.transporter).toBeNull();
            await mailer.init();
            expect(mailer.transporter).not.toBeNull();
        });
    });

    describe('sendMail', () => {
        test('does not throw error if uninitialized', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            await mailer.sendMail('', '', '');
        });

        test('sends message using transporter', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            await mailer.init();
            await mailer.sendMail(TEST_USER_EMAIL, 'Test subject', 'Test body');
            const success = await mailer.transporter.verify();
            expect(success).toBeTruthy();
        });

        test('sends message with the expected fields', async () => {
            const subject = 'Test subject';
            const body = 'Test body';
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendMail(TEST_USER_EMAIL, subject, body);
            expect(mockSendMail).toHaveBeenCalledWith({
                from: TEST_CONFIG.smtp.fromAddress,
                to: TEST_USER_EMAIL,
                subject: subject,
                text: body,
            });
        });
    });

    describe('sendPlayerEmailUpdatedMessage', () => {
        test('sends message with the correct subject and body', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendPlayerEmailUpdatedMessage('Fred', 'newfred@example.com', 'oldfred@example.com');
            expect(mockSendMail).toHaveBeenCalledWith({
                from: TEST_CONFIG.smtp.fromAddress,
                to: 'oldfred@example.com',
                subject: '[Test App] Your email address was changed on Test App',
                text: EXPECTED_PLAYER_EMAIL_UPDATED_EMAIL_BODY,
            });
        });

        test('does not send message if new email is empty', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendPlayerEmailUpdatedMessage('Fred', '', 'oldfred@example.com');
            expect(mockSendMail).not.toHaveBeenCalled();
        });

        test('does not send message if old email is empty', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendPlayerEmailUpdatedMessage('Fred', 'newfred@example.com', '');
            expect(mockSendMail).not.toHaveBeenCalled();
        });
    });

    describe('sendPlayerRegisteredMessage', () => {
        test('sends message with the correct subject and body', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendPlayerRegisteredMessage(TEST_PLAYER);
            expect(mockSendMail).toHaveBeenCalledWith({
                from: TEST_CONFIG.smtp.fromAddress,
                to: TEST_USER_EMAIL,
                subject: '[Test App] Welcome to Test App, Fred!',
                text: EXPECTED_PLAYER_REGISTERED_EMAIL_BODY,
            });
        });
    });

    describe('sendPlayerRetrievalMessage', () => {
        test('sends message with the correct subject and body', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendPlayerRetrievalMessage(TEST_PLAYER);
            expect(mockSendMail).toHaveBeenCalledWith({
                from: TEST_CONFIG.smtp.fromAddress,
                to: TEST_USER_EMAIL,
                subject: '[Test App] Fred, here\'s your player restoration link!',
                text: EXPECTED_PLAYER_RETRIEVAL_EMAIL_BODY,
            });
        });
    });

    describe('sendRoomCreatedMessage', () => {
        test('sends message with the correct subject and body', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendRoomCreatedMessage(TEST_ROOM_CODE, TEST_ROOM_LINK_REQUEST);
            expect(mockSendMail).toHaveBeenCalledWith({
                from: TEST_CONFIG.smtp.fromAddress,
                to: TEST_USER_EMAIL,
                subject: '[Test App] Room TEST created successfully',
                text: EXPECTED_ROOM_CREATED_EMAIL_BODY,
            });
        });
    });

    describe('sendRoomLinkRequestApprovedMessage', () => {
        test('sends message with the correct subject and body', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendRoomLinkRequestApprovedMessage(TEST_ROOM_LINK_REQUEST);
            expect(mockSendMail).toHaveBeenCalledWith({
                from: TEST_CONFIG.smtp.fromAddress,
                to: TEST_USER_EMAIL,
                subject: '[Test App] Fred, your room link request has been approved!',
                text: EXPECTED_ROOM_REQUEST_APPROVED_EMAIL_BODY,
            });
        });
    });

    describe('sendRoomLinkRequestCreatedMessage', () => {
        test('sends message to the admin with the correct subject and body', async () => {
            const mailer = new Mailer(TEST_CONFIG);
            const mockSendMail = jest.fn();
            mailer.transporter = {sendMail: mockSendMail};
            await mailer.sendRoomLinkRequestCreatedMessage(TEST_ROOM_LINK_REQUEST);
            expect(mockSendMail).toHaveBeenCalledWith({
                from: TEST_CONFIG.smtp.fromAddress,
                to: TEST_ADMIN_EMAIL,
                subject: '[Test App] New room link request',
                text: EXPECTED_ROOM_REQUEST_CREATED_EMAIL_BODY,
            });
        });
    });
});
