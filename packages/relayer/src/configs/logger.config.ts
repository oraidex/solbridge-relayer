import { createLogger, format, transports } from "winston";

export const logger = (label: string, loglevel?: string) =>
  createLogger({
    level: loglevel || "info",
    format: format.combine(
      format.label({ label }),
      format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      format.printf((info) => {
        return `${info.timestamp} [${info.level.toUpperCase()}] [${info.label}]: ${info.message}`;
      })
    ),
    transports: [new transports.Console()],
  });
