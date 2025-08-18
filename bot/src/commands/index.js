import * as joinMod from "./join.js";
import * as logsMod from "./logs.js";
import * as leaveMod from "./leave.js";
import * as playback from "./playback.js";
import * as transcript from "./transcript.js";


function normalize(mod) {
    const cmd = mod.default ?? mod;
    if (!cmd?.data) throw new Error("Command missing .data");
    const name = cmd.data.name ?? cmd.data.toJSON?.().name;
    if (!name) throw new Error("Command .data missing name");
    if (typeof cmd.execute !== "function") throw new Error("Command missing execute()");
    return [name, cmd];
}

const commands = new Map([
    normalize(joinMod),
    normalize(logsMod),
    normalize(leaveMod),
    normalize(playback),
    normalize(transcript)
]);

export default commands;