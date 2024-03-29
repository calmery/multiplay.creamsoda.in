import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { Server } from "socket.io";
import * as uuid from "uuid";
import {
  MultiplayJoinGroupResponse,
  MultiplayJoinPayload,
  MultiplayJoinResponse,
  MultiplayLeaveGroupResponse,
  MultiplaySocket,
  MultiplayUpdatePayload,
  MultiplayUpdateResponse
} from "./types/Multiplay";

/* --- Env --- */

dotenv.config();

/* --- Constants --- */

const origin = ["http://localhost:3000", "https://metaneno.art"];

/* --- Express --- */

const app = express();

app.use(
  cors({
    credentials: true,
    maxAge: 1800,
    methods: ["DELETE", "GET", "POST", "PUT"],
    origin
  })
);

app.get("/a/dream", (_, response) => {
  response.status(200).end();
});

const server = app.listen(process.env.PORT || 5000);

/* --- Socket.IO --- */

const io = new Server(server, {
  cors: { origin },
  path: "/a/dream"
});

/* --- Multiplay --- */

// Utility

export const response = <T extends unknown>(payload: T): T => payload;

// States

const groups: Record<string, number> = {};

// Helper Functions

const getCanParticipateGroupId = () => {
  const maybeGroupId = Object.keys(groups)
    .sort((x, y) => {
      if (groups[x] < groups[y]) return 1;
      if (groups[x] > groups[y]) return -1;
      return 0;
    })
    .find(group => groups[group] < 4 && uuid.validate(group));

  if (maybeGroupId) {
    return maybeGroupId;
  }

  return uuid.v4();
};

const getPlayerIds = (groupId: string) => {
  const group = io.sockets.adapter.rooms.get(groupId);

  if (!group) {
    return [];
  }

  return Array.from(group.keys());
};

const validateGroupId = (maybeGroupId?: string) => {
  if (!maybeGroupId) {
    return true;
  }

  const matched = maybeGroupId.match(/\w+/);

  return (
    4 <= maybeGroupId.length &&
    maybeGroupId.length <= 16 &&
    matched &&
    matched[0] === maybeGroupId
  );
};

// Events

const join = async (
  socket: MultiplaySocket,
  maybeGroupId: MultiplayJoinPayload
) => {
  if (socket.groupId || !validateGroupId(maybeGroupId)) return;

  const groupId = maybeGroupId || getCanParticipateGroupId();
  await socket.join(groupId);

  const playerIds = getPlayerIds(groupId);
  groups[groupId] = playerIds.length;
  socket.groupId = groupId;

  socket.emit("joined", response<MultiplayJoinResponse>(playerIds));
  socket.broadcast
    .to(groupId)
    .emit("joined", response<MultiplayJoinGroupResponse>(playerIds));
};

const leave = async (socket: MultiplaySocket) => {
  const groupId = socket.groupId;

  if (!groupId) return;

  await socket.leave(groupId);

  const playerIds = getPlayerIds(groupId);
  groups[groupId] = playerIds.length;

  if (groups[groupId] === 0) {
    delete groups[groupId];
  }

  delete socket.groupId;

  if (!socket.disconnected) {
    socket.emit("leaved");
  }

  socket.broadcast
    .to(groupId)
    .emit("leaved", response<MultiplayLeaveGroupResponse>(playerIds));
};

const update = async (
  metaneno: boolean,
  socket: MultiplaySocket,
  { accessory, area, position, rotation, state }: MultiplayUpdatePayload
) => {
  if (!socket.groupId) {
    return;
  }

  const broadcast = metaneno
    ? socket.broadcast
    : socket.broadcast.to(socket.groupId);

  broadcast.emit(
    "updated",
    response<MultiplayUpdateResponse>({
      playerId: socket.id,
      payload: {
        accessory,
        area,
        metaneno,
        position: {
          x: position.x,
          y: position.y,
          z: position.z
        },
        rotation: {
          y: rotation.y
        },
        state,
        updatedAt: new Date().getTime()
      }
    })
  );
};

// Main

io.on("connection", (socket: MultiplaySocket) => {
  const handleDisconnect = leave.bind(null, socket);
  const handleJoin = join.bind(null, socket);
  const handleLeave = leave.bind(null, socket);

  socket.on("disconnect", handleDisconnect);
  socket.on("join", handleJoin);
  socket.on("leave", handleLeave);

  //

  const { authorization } = socket.request.headers;

  if (
    authorization &&
    authorization.startsWith("Token") &&
    authorization.slice(6) === process.env.METANENO_TOKEN
  ) {
    socket.on("update", update.bind(null, true, socket));
  } else {
    socket.on("update", update.bind(null, false, socket));
  }
});
