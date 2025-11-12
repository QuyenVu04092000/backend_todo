import { EventEmitter } from "events";

const todoEvents = new EventEmitter();
todoEvents.setMaxListeners(100);

export default todoEvents;

