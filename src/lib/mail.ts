import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | undefined;

function getTransporter(host: string): Transporter {
  transporter ??= nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.info(`[mail] SMTP_HOST chưa cấu hình, bỏ qua gửi mail tới ${to}: ${subject}\n${html}`);
    return;
  }
  await getTransporter(host).sendMail({
    from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}
