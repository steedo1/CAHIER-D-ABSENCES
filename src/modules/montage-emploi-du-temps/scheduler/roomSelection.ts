import type { LessonBlock, Room, SchedulerContext } from "./types";
import {
  canUseOrdinaryRoomFallback,
  getEffectiveRoomTypeRequired,
  isOrdinaryFallbackRoom,
} from "./terrainRules";

function uniqueRooms(rooms: Room[]): Room[] {
  const seen = new Set<string>();
  const result: Room[] = [];

  for (const room of rooms) {
    if (!seen.has(room.id)) {
      seen.add(room.id);
      result.push(room);
    }
  }

  return result;
}

export function getRoomsByType(roomType: string, context: SchedulerContext): Room[] {
  return context.rooms.filter((room) => room.roomType === roomType);
}

export function hasRoomTypeAvailable(
  roomType: string,
  context: SchedulerContext,
): boolean {
  return getRoomsByType(roomType, context).length > 0;
}

export function getMainRoomsForClass(
  classId: string,
  context: SchedulerContext,
): Room[] {
  const roomIds = context.roomPreferences
    .filter(
      (preference) =>
        preference.classId === classId &&
        preference.isAllowed &&
        preference.usageType === "main",
    )
    .sort((a, b) => a.priority - b.priority)
    .map((preference) => preference.roomId);

  return roomIds
    .map((roomId) => context.rooms.find((room) => room.id === roomId))
    .filter((room): room is Room => Boolean(room));
}

export function getAlternativeRoomsForClass(
  classId: string,
  context: SchedulerContext,
): Room[] {
  const roomIds = context.roomPreferences
    .filter(
      (preference) =>
        preference.classId === classId &&
        preference.isAllowed &&
        preference.usageType === "alternative",
    )
    .sort((a, b) => a.priority - b.priority)
    .map((preference) => preference.roomId);

  return roomIds
    .map((roomId) => context.rooms.find((room) => room.id === roomId))
    .filter((room): room is Room => Boolean(room));
}

export function getSpecializedRoomsForClass(
  classId: string,
  context: SchedulerContext,
): Room[] {
  const roomIds = context.roomPreferences
    .filter(
      (preference) =>
        preference.classId === classId &&
        preference.isAllowed &&
        preference.usageType === "specialized",
    )
    .sort((a, b) => a.priority - b.priority)
    .map((preference) => preference.roomId);

  return roomIds
    .map((roomId) => context.rooms.find((room) => room.id === roomId))
    .filter((room): room is Room => Boolean(room));
}

export function getOrdinaryFallbackRoomsForClass(
  classId: string,
  context: SchedulerContext,
): Room[] {
  const mainRooms = getMainRoomsForClass(classId, context).filter((room) =>
    isOrdinaryFallbackRoom(room.roomType),
  );
  const alternativeRooms = getAlternativeRoomsForClass(classId, context).filter(
    (room) => isOrdinaryFallbackRoom(room.roomType),
  );

  const preferredRooms = uniqueRooms([...mainRooms, ...alternativeRooms]);

  if (preferredRooms.length > 0) {
    return preferredRooms;
  }

  return context.rooms.filter((room) => isOrdinaryFallbackRoom(room.roomType));
}

function getFallbackRoomsForClass(
  classId: string,
  context: SchedulerContext,
): Room[] {
  const mainRooms = getMainRoomsForClass(classId, context);
  const alternativeRooms = getAlternativeRoomsForClass(classId, context);
  const specializedRooms = getSpecializedRoomsForClass(classId, context);

  const preferredRooms = uniqueRooms([
    ...mainRooms,
    ...alternativeRooms,
    ...specializedRooms,
  ]);

  if (preferredRooms.length > 0) {
    return preferredRooms;
  }

  return context.rooms.filter(
    (room) => room.roomType === "ordinary" || room.roomType === "multipurpose",
  );
}

export type RoomSearchGroup = {
  kind: "primary" | "fallback" | "ordinary";
  rooms: Room[];
};

export function getPrimaryRoomsForBlock(
  block: LessonBlock,
  context: SchedulerContext,
): Room[] {
  const requiredRoomType = getEffectiveRoomTypeRequired(block, context);

  if (!requiredRoomType) {
    return getFallbackRoomsForClass(block.classId, context);
  }

  return getRoomsByType(requiredRoomType, context);
}

export function getFallbackRoomsForBlock(
  block: LessonBlock,
  context: SchedulerContext,
): Room[] {
  const requiredRoomType = getEffectiveRoomTypeRequired(block, context);

  if (!requiredRoomType || !canUseOrdinaryRoomFallback(requiredRoomType, context)) {
    return [];
  }

  return getOrdinaryFallbackRoomsForClass(block.classId, context);
}

export function getRoomSearchGroupsForBlock(
  block: LessonBlock,
  context: SchedulerContext,
): RoomSearchGroup[] {
  const requiredRoomType = getEffectiveRoomTypeRequired(block, context);

  if (!requiredRoomType) {
    return [{ kind: "ordinary", rooms: getFallbackRoomsForClass(block.classId, context) }];
  }

  const primaryRooms = getPrimaryRoomsForBlock(block, context);
  const fallbackRooms = getFallbackRoomsForBlock(block, context);
  const groups: RoomSearchGroup[] = [];

  // Logique métier validée : laboratoire / terrain d’abord.
  // Pour EPS : si un terrain existe, aucune salle ordinaire n’est proposée.
  if (primaryRooms.length > 0) {
    groups.push({ kind: "primary", rooms: primaryRooms });
  }

  if (fallbackRooms.length > 0) {
    groups.push({ kind: "fallback", rooms: fallbackRooms });
  }

  return groups;
}

export function getPossibleRoomsForBlock(
  block: LessonBlock,
  context: SchedulerContext,
): Room[] {
  return uniqueRooms(
    getRoomSearchGroupsForBlock(block, context).flatMap((group) => group.rooms),
  );
}
