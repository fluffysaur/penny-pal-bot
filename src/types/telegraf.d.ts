declare module "telegraf" {
  export class Telegraf {
    constructor(token: string);
    start(callback: (ctx: any) => any): any;
    command(command: string, callback: (ctx: any) => any): any;
    action(action: any, callback: (ctx: any) => any): any;
    on(event: any, callback: (ctx: any) => any): any;
    launch(): Promise<void>;
    stop(reason?: string): void;
  }

  export const Markup: {
    inlineKeyboard(buttons: any[]): any;
    button: {
      callback(text: string, data: string): any;
    };
  };
}
