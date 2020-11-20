import { LocationObject } from '@runejs/cache-parser';
import { Position } from '@server/world/position';
import { world } from '@server/game-server';
import { WorldItem } from '@server/world/items/world-item';
import { Item } from '@server/world/items/item';
import { Player } from '@server/world/actor/player/player';
import { World } from '@server/world/index';


/**
 * Modifications made to a single game world map chunk.
 */
interface WorldModifications {
    spawnedObjects?: LocationObject[];
    hiddenObjects?: LocationObject[];
    worldItems?: WorldItem[];
}

/**
 * A player or group instance within the world.
 */
export class WorldInstance {

    /**
     * A list of game world chunks that have modifications made to them in this instance.
     */
    public readonly chunkModifications: Map<string, Map<string, WorldModifications>> = new Map<string, Map<string, WorldModifications>>();

    public constructor(public readonly instanceId: string = null) {
    }

    /**
     * Spawns a new world item in this instance.
     * @param item The item to spawn into the game world.
     * @param position The position to spawn the item at.
     * @param owner [optional] The original owner of the item, if there is one.
     * @param expires [optional] When the world object should expire and de-spawn.
     * If not provided, the item will stay within the instance indefinitely.
     */
    public spawnWorldItem(item: Item | number, position: Position, owner?: Player, expires?: number): WorldItem {
        if(typeof item === 'number') {
            item = { itemId: item, amount: 1 };
        }
        const worldItem: WorldItem = {
            itemId: item.itemId,
            amount: item.amount,
            position,
            owner,
            expires,
            instanceId: this.instanceId
        };

        const chunkMap = this.getWorldModifications(position);

        let chunkMod: WorldModifications = {};
        if(chunkMap.has(position.key)) {
            chunkMod = chunkMap.get(position.key);
        }

        if(!chunkMod.worldItems) {
            chunkMod.worldItems = [];
        }

        chunkMod.worldItems.push(worldItem);

        chunkMap.set(position.key, chunkMod);

        if(owner) {
            // If this world item is only visible to one player initially, we setup a timeout to spawn it for all other
            // players after 100 game cycles.
            owner.outgoingPackets.setWorldItem(worldItem, worldItem.position);
            setTimeout(() => {
                if(worldItem.removed) {
                    return;
                }

                this.worldItemAdded(worldItem, owner);
                worldItem.owner = undefined;
            }, 100 * World.TICK_LENGTH);
        } else {
            this.worldItemAdded(worldItem);
        }

        if(expires) {
            // If the world item is set to expire, set up a timeout to remove it from the game world after the
            // specified number of game cycles.
            setTimeout(() => {
                if(worldItem.removed) {
                    return;
                }

                this.despawnWorldItem(worldItem);
            }, expires * World.TICK_LENGTH);
        }

        return worldItem;
    }

    /**
     * De-spawns a world item from this instance.
     * @param worldItem The world item to de-spawn.
     */
    public despawnWorldItem(worldItem: WorldItem): void {
        const chunkMap = this.getWorldModifications(worldItem.position);

        if(!chunkMap.has(worldItem.position.key)) {
            // Object no longer exists
            return;
        }

        const chunkMod = chunkMap.get(worldItem.position.key);
        if(chunkMod.worldItems && chunkMod.worldItems.length !== 0) {
            const idx = chunkMod.worldItems.findIndex(i => i.itemId === worldItem.itemId && i.amount === worldItem.amount);
            if(idx !== -1) {
                chunkMod.worldItems.splice(idx, 1);
            }
        }

        if(chunkMod.worldItems.length === 0) {
            delete chunkMod.worldItems;
        }

        worldItem.removed = true;
        this.worldItemRemoved(worldItem);
    }

    /**
     * Adds a world item to the view of any nearby players in this instance.
     * @param worldItem The world item that was added.
     * @param excludePlayer [optional] A specific player to not show this world item update to.
     * Usually this is used when a player drops the item and it should appear for them immediately, but have a delay
     * before being shown to other players in the instance.
     */
    public worldItemAdded(worldItem: WorldItem, excludePlayer?: Player): void {
        const nearbyPlayers = world.findNearbyPlayers(worldItem.position, 16, this.instanceId) || [];

        nearbyPlayers.forEach(player => {
            if(excludePlayer && excludePlayer.equals(player)) {
                return;
            }

            player.outgoingPackets.setWorldItem(worldItem, worldItem.position);
        });
    }

    /**
     * Removes a world item from the view of any nearby players in this instance.
     * @param worldItem The world item that was removed.
     */
    public worldItemRemoved(worldItem: WorldItem): void {
        const nearbyPlayers = world.findNearbyPlayers(worldItem.position, 16, this.instanceId) || [];

        nearbyPlayers.forEach(player => {
            player.outgoingPackets.removeWorldItem(worldItem, worldItem.position);
        });
    }

    /**
     * Spawn a new game object into the instance.
     * @param object The game object to spawn.
     */
    public spawnGameObject(object: LocationObject): void {
        const position = new Position(object.x, object.y, object.level);
        const chunkMap = this.getWorldModifications(position);

        let chunkMod: WorldModifications = {};
        if(chunkMap.has(position.key)) {
            chunkMod = chunkMap.get(position.key);
        }

        if(!chunkMod.spawnedObjects) {
            chunkMod.spawnedObjects = [];
        }

        chunkMod.spawnedObjects.push(object);

        chunkMap.set(position.key, chunkMod);
    }

    /**
     * Remove a previously spawned game object from the instance.
     * @param object The game object to de-spawn.
     */
    public despawnGameObject(object: LocationObject): void {
        const position = new Position(object.x, object.y, object.level);
        const chunkMap = this.getWorldModifications(position);

        if(!chunkMap.has(position.key)) {
            // Object no longer exists
            return;
        }

        const chunkMod = chunkMap.get(position.key);
        if(chunkMod.spawnedObjects && chunkMod.spawnedObjects.length !== 0) {
            const idx = chunkMod.spawnedObjects.findIndex(o => o.objectId === object.objectId &&
                o.type === object.type && o.orientation === object.orientation);
            if(idx !== -1) {
                chunkMod.spawnedObjects.splice(idx, 1);
            }
        }

        if(chunkMod.spawnedObjects.length === 0) {
            delete chunkMod.spawnedObjects;
        }
    }

    /**
     * Hides a static game object from an instance.
     * @param object The cache game object to hide from the instance.
     */
    public hideGameObject(object: LocationObject): void {
        const position = new Position(object.x, object.y, object.level);
        const chunkMap = this.getWorldModifications(position);

        let chunkMod: WorldModifications = {};
        if(chunkMap.has(position.key)) {
            chunkMod = chunkMap.get(position.key);
        }

        if(!chunkMod.hiddenObjects) {
            chunkMod.hiddenObjects = [];
        }

        chunkMod.hiddenObjects.push(object);

        chunkMap.set(position.key, chunkMod);
    }

    /**
     * Shows a previously hidden static game object.
     * @param object The cache game object to stop hiding from view.
     */
    public showGameObject(object: LocationObject): void {
        const position = new Position(object.x, object.y, object.level);
        const chunkMap = this.getWorldModifications(position);

        if(!chunkMap.has(position.key)) {
            // Object no longer exists
            return;
        }

        const chunkMod = chunkMap.get(position.key);
        if(chunkMod.hiddenObjects && chunkMod.hiddenObjects.length !== 0) {
            const idx = chunkMod.hiddenObjects.findIndex(o => o.objectId === object.objectId &&
                o.type === object.type && o.orientation === object.orientation);
            if(idx !== -1) {
                chunkMod.hiddenObjects.splice(idx, 1);
            }
        }

        if(chunkMod.hiddenObjects.length === 0) {
            delete chunkMod.hiddenObjects;
        }
    }

    /**
     * Fetch a list of world modifications from this instance.
     * @param worldPosition The game world position to find the chunk for.
     */
    public getWorldModifications(worldPosition: Position): Map<string, WorldModifications>;


    /**
     * Fetch a list of world modifications from this instance.
     * @param x The X coordinate to find the chunk of.
     * @param y The Y coordinate to find the chunk of.
     * @param level The height level of the chunk.
     */
    public getWorldModifications(x: number, y: number, level: number): Map<string, WorldModifications>;

    public getWorldModifications(worldPositionOrX: Position | number, y?: number, level?: number): Map<string, WorldModifications> {
        let chunkPosition: Position;

        if(typeof worldPositionOrX === 'number') {
            const chunk = world.chunkManager.getChunk({ x: worldPositionOrX, y, level }) || null;
            if(chunk) {
                chunkPosition = chunk.position;
            }
        } else {
            chunkPosition = world.chunkManager.getChunkForWorldPosition(worldPositionOrX)?.position || null;
        }

        if(!chunkPosition) {
            // Chunk not found - fail gracefully
            return new Map<string, WorldModifications>();
        }

        if(!this.chunkModifications.has(chunkPosition.key)) {
            this.chunkModifications.set(chunkPosition.key, new Map<string, WorldModifications>());
        }

        return this.chunkModifications.get(chunkPosition.key);
    }

}
