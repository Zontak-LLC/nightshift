/**
 * The board page's script, sent as text (the page loads nothing else). It asks the server for nothing: the server
 * pushes the whole board over /events whenever it changes. Every value from the logs is set with textContent.
 * Written without template literals so it can live inside this string.
 */
import { CLIENT_END } from "./client-end.js";
import { CLIENT_START } from "./client-start.js";

export const CLIENT = CLIENT_START + CLIENT_END;
