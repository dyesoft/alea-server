import log from 'log';
import nodemailer from 'nodemailer';

export const TEST_SMTP_HOST = 'smtp.ethereal.email';

export const ADMIN_EMAIL_PLACEHOLDER = '{{ADMIN_EMAIL}}';
export const ADMIN_EMAIL_SIGNATURE_PLACEHOLDER = '{{ADMIN_EMAIL_SIGNATURE}}';
export const APP_BASE_URL_PLACEHOLDER = '{{APP_BASE_URL}}';
export const APP_NAME_PLACEHOLDER = '{{APP_NAME}}';
export const DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER = '{{DEFAULT_EMAIL_SIGNATURE}}';
export const GAME_TYPE_PLACEHOLDER = '{{GAME_TYPE}}';
export const PLAYER_EMAIL_UPDATED_SALUTATION_PLACEHOLDER = '{{PLAYER_EMAIL_UPDATED_SALUTATION}}';
export const PLAYER_REGISTRATION_SALUTATION_PLACEHOLDER = '{{PLAYER_REGISTRATION_SALUTATION}}';
export const PLAYER_RETRIEVAL_SALUTATION_PLACEHOLDER = '{{PLAYER_RETRIEVAL_SALUTATION}}';
export const ROOM_REQUEST_APPROVED_SALUTATION_PLACEHOLDER = '{{ROOM_REQUEST_APPROVED_SALUTATION}}';

export const EMAIL_PLACEHOLDER = '{{EMAIL}}';
export const NAME_PLACEHOLDER = '{{NAME}}';
export const PLAYER_ID_PLACEHOLDER = '{{PLAYER_ID}}';
export const REQUEST_ID_PLACEHOLDER = '{{REQUEST_ID}}';
export const ROOM_PLACEHOLDER = '{{ROOM}}';

export class EmailTemplates {
    constructor(subjectTemplate, bodyTemplate) {
        this.subjectTemplate = subjectTemplate;
        this.bodyTemplate = bodyTemplate;
    }

    apply(mailer) {
        return {
            subject: `[${mailer.messages.app.name}] ` + this.subjectTemplate.replaceAll(APP_NAME_PLACEHOLDER, mailer.messages.app.name),
            body: this.bodyTemplate.
                replaceAll(ADMIN_EMAIL_PLACEHOLDER, mailer.adminEmail).
                replaceAll(ADMIN_EMAIL_SIGNATURE_PLACEHOLDER, mailer.messages.signature.admin).
                replaceAll(APP_BASE_URL_PLACEHOLDER, mailer.messages.app.baseURL).
                replaceAll(APP_NAME_PLACEHOLDER, mailer.messages.app.name).
                replaceAll(DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER, mailer.messages.signature.default).
                replaceAll(GAME_TYPE_PLACEHOLDER, mailer.messages.game.type || 'games').
                replaceAll(PLAYER_EMAIL_UPDATED_SALUTATION_PLACEHOLDER, mailer.messages.player.emailUpdated.salutation).
                replaceAll(PLAYER_REGISTRATION_SALUTATION_PLACEHOLDER, mailer.messages.player.registered.salutation).
                replaceAll(PLAYER_RETRIEVAL_SALUTATION_PLACEHOLDER, mailer.messages.player.retrieved.salutation).
                replaceAll(ROOM_REQUEST_APPROVED_SALUTATION_PLACEHOLDER, mailer.messages.room.requestApproved.salutation),
        };
    }
}

const PLAYER_EMAIL_UPDATED_TEMPLATE = new EmailTemplates(
    `Your email address was changed on ${APP_NAME_PLACEHOLDER}`,
    (
        `Dear ${NAME_PLACEHOLDER},\n` +
        `\n` +
        `We recently received a request to change the email address on your ${APP_NAME_PLACEHOLDER} account from this address to ${EMAIL_PLACEHOLDER}. If you made this request, no further action is required.\n` +
        `\n` +
        `If you did not make this request, please contact the administrator at ${ADMIN_EMAIL_PLACEHOLDER} to report potential abuse.\n` +
        `\n` +
        `${PLAYER_EMAIL_UPDATED_SALUTATION_PLACEHOLDER}\n` +
        `${DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER}`
    )
);

const PLAYER_REGISTERED_TEMPLATE = new EmailTemplates(
    `Welcome to ${APP_NAME_PLACEHOLDER}, ${NAME_PLACEHOLDER}!`,
    (
        `Dear ${NAME_PLACEHOLDER},\n` +
        `\n` +
        `Thank you for registering your account with ${APP_NAME_PLACEHOLDER}! By registering with your email address, you will be able to restore your player account if you ever lose it in the future.\n` +
        `\n` +
        `If you did not recently create an account at ${APP_BASE_URL_PLACEHOLDER}, please contact the administrator at ${ADMIN_EMAIL_PLACEHOLDER} to report potential abuse.\n` +
        `\n` +
        `${PLAYER_REGISTRATION_SALUTATION_PLACEHOLDER}\n` +
        `${DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER}`
    )
);

const PLAYER_RETRIEVAL_TEMPLATE = new EmailTemplates(
    `${NAME_PLACEHOLDER}, here's your player restoration link!`,
    (
        `Dear ${NAME_PLACEHOLDER},\n` +
        `\n` +
        `We recently received a request to restore your previous player account on ${APP_NAME_PLACEHOLDER}. If this was you, please use the link below to restore your account:\n` +
        `\n` +
        `${APP_BASE_URL_PLACEHOLDER}?pid=${PLAYER_ID_PLACEHOLDER}\n` +
        `\n` +
        `If you did not make this request, please contact the administrator at ${ADMIN_EMAIL_PLACEHOLDER} to report potential abuse.\n` +
        `\n` +
        `${PLAYER_RETRIEVAL_SALUTATION_PLACEHOLDER}\n` +
        `${DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER}`
    )
);

const ROOM_CREATED_TEMPLATE = new EmailTemplates(
    `Room ${ROOM_PLACEHOLDER} created successfully`,
    (
        `Dear ${NAME_PLACEHOLDER},\n` +
        `\n` +
        `Your room ${ROOM_PLACEHOLDER} is now ready to go!\n` +
        `\n` +
        `When you're ready, visit ${APP_BASE_URL_PLACEHOLDER}/p/${ROOM_PLACEHOLDER} to play unlimited ${GAME_TYPE_PLACEHOLDER} with your friends!\n` +
        `\n` +
        `This link will always be yours, so feel free to bookmark it, or send it to others so they can play with you.\n` +
        `${DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER}`
    )
);

const ROOM_REQUEST_APPROVED_TEMPLATE = new EmailTemplates(
    `${NAME_PLACEHOLDER}, your room link request has been approved!`,
    (
        `Dear ${NAME_PLACEHOLDER},\n` +
        `\n` +
        `Your request to create a new room in ${APP_NAME_PLACEHOLDER} has just been approved!\n` +
        `\n` +
        `Please visit ${APP_BASE_URL_PLACEHOLDER}?req=${REQUEST_ID_PLACEHOLDER} and click "Create New Room" to create your room. If you have never played ${APP_NAME_PLACEHOLDER} before, you will have to create a player before you can create a room.\n` +
        `\n` +
        `Once you have created your room, you can send the room code or a link to the room to your friends, and they can join your room and play with you.\n` +
        `\n` +
        `${ROOM_REQUEST_APPROVED_SALUTATION_PLACEHOLDER}\n` +
        `${DEFAULT_EMAIL_SIGNATURE_PLACEHOLDER}`
    )
);

const ROOM_REQUEST_CREATED_TEMPLATE = new EmailTemplates(
    'New room link request',
    (
        `A new ${APP_NAME_PLACEHOLDER} room link request has just been submitted by ${NAME_PLACEHOLDER} (${EMAIL_PLACEHOLDER}).\n` +
        `\n` +
        `Please visit ${APP_BASE_URL_PLACEHOLDER} to approve or reject this request.\n` +
        `${ADMIN_EMAIL_SIGNATURE_PLACEHOLDER}`
    )
);

const logger = log.get('mail');

export class Mailer {
    constructor(config) {
        this.adminEmail = config.admin.email;
        this.smtpConfig = config.smtp;
        this.messages = config.messages.email;
        this.transporter = null;
    }

    async init() {
        try {
            let user, password;
            if (this.smtpConfig.host === TEST_SMTP_HOST) {
                const testAccount = await nodemailer.createTestAccount();
                user = testAccount.user;
                password = testAccount.pass;
            } else {
                user = this.smtpConfig.user;
                password = this.smtpConfig.password;
            }
            this.transporter = nodemailer.createTransport({
                host: this.smtpConfig.host,
                port: this.smtpConfig.port,
                secure: false, // true for 465, false for other ports
                auth: {
                    user: user,
                    pass: password,
                },
            });
        } catch (e) {
            logger.error(`Failed to initialize mail transport: ${e}`);
        }
    }

    async sendMail(to, subject, body) {
        if (!this.transporter) {
            logger.error('Failed to send mail: mail transport was not initialized successfully');
            return;
        }
        const message = {
            from: this.smtpConfig.fromAddress,
            to: to,
            subject: subject,
            text: body,
        };
        try {
            const info = await this.transporter.sendMail(message);
            logger.info(`Successfully sent mail to "${to}" with subject "${subject}".`);
            const previewURL = nodemailer.getTestMessageUrl(info);
            if (previewURL) {
                logger.info(`Preview URL: ${previewURL}`);
            }
        } catch (e) {
            logger.error(`Failed to send mail to "${to}" with subject "${subject}": ${e}`);
        }
    }

    async sendPlayerEmailUpdatedMessage(name, newEmail, prevEmail) {
        newEmail = newEmail || '';
        prevEmail = prevEmail || '';
        if (newEmail.length === 0 || prevEmail.length === 0) {
            return;
        }
        let { subject, body } = PLAYER_EMAIL_UPDATED_TEMPLATE.apply(this);
        subject = subject.replaceAll(NAME_PLACEHOLDER, name);
        body = body.replaceAll(NAME_PLACEHOLDER, name).replaceAll(EMAIL_PLACEHOLDER, newEmail);
        await this.sendMail(prevEmail, subject, body);
    }

    async sendPlayerRegisteredMessage(player) {
        const { email, name } = player;
        let { subject, body } = PLAYER_REGISTERED_TEMPLATE.apply(this);
        subject = subject.replaceAll(NAME_PLACEHOLDER, name);
        body = body.replaceAll(NAME_PLACEHOLDER, name);
        await this.sendMail(email, subject, body);
    }

    async sendPlayerRetrievalMessage(player) {
        const { email, name, playerID } = player;
        let { subject, body } = PLAYER_RETRIEVAL_TEMPLATE.apply(this);
        subject = subject.replaceAll(NAME_PLACEHOLDER, name);
        body = body.replaceAll(NAME_PLACEHOLDER, name).replaceAll(PLAYER_ID_PLACEHOLDER, playerID);
        await this.sendMail(email, subject, body);
    }

    async sendRoomCreatedMessage(roomCode, roomLinkRequest) {
        const { email, name } = roomLinkRequest;
        let { subject, body } = ROOM_CREATED_TEMPLATE.apply(this);
        subject = subject.replaceAll(ROOM_PLACEHOLDER, roomCode);
        body = body.replaceAll(NAME_PLACEHOLDER, name).replaceAll(ROOM_PLACEHOLDER, roomCode);
        await this.sendMail(email, subject, body);
    }

    async sendRoomLinkRequestApprovedMessage(roomLinkRequest) {
        const { email, name, requestID } = roomLinkRequest;
        let { subject, body } = ROOM_REQUEST_APPROVED_TEMPLATE.apply(this);
        subject = subject.replaceAll(NAME_PLACEHOLDER, name);
        body = body.replaceAll(NAME_PLACEHOLDER, name).replaceAll(REQUEST_ID_PLACEHOLDER, requestID);
        await this.sendMail(email, subject, body);
    }

    async sendRoomLinkRequestCreatedMessage(roomLinkRequest) {
        const { email, name } = roomLinkRequest;
        let { subject, body } = ROOM_REQUEST_CREATED_TEMPLATE.apply(this);
        body = body.replaceAll(EMAIL_PLACEHOLDER, email).replaceAll(NAME_PLACEHOLDER, name);
        await this.sendMail(this.adminEmail, subject, body);
    }
}
