import {
  availableAmount,
  bjornifyFamiliar,
  cliExecute,
  enthroneFamiliar,
  getClanId,
  getClanName,
  handlingChoice,
  Item,
  print,
  putStash,
  refreshStash,
  retrieveItem,
  stashAmount,
  takeStash,
  toItem,
  visitUrl,
} from "kolmafia";
import { $familiar, $item, $items, $monster, Clan, get, getFoldGroup, have, set } from "libram";
import { Macro } from "./combat";
import { HIGHLIGHT, userConfirmDialog } from "./lib";

export const stashItems = get("garboStashItems", "")
  .split(",")
  .filter((x) => x.trim().length > 0)
  .map((id) => toItem(id));

export function withStash<T>(itemsToTake: Item[], action: () => T): T {
  const manager = new StashManager();
  try {
    manager.take(...itemsToTake);
    return action();
  } finally {
    manager.putBackAll();
  }
}

export function withVIPClan<T>(action: () => T): T {
  const clanIdOrNameString = get("garbo_vipClan");
  let clanIdOrName = clanIdOrNameString.match(/^\d+$/)
    ? parseInt(clanIdOrNameString)
    : clanIdOrNameString;
  if (clanIdOrName === "" && have($item`Clan VIP Lounge key`)) {
    if (
      userConfirmDialog(
        "The preference 'garbo_vipClan' is not set. Use the current clan as a VIP clan? (Defaults to yes in 15 seconds)",
        true,
        15000
      )
    ) {
      clanIdOrName = getClanId();
      set("garbo_vipClan", clanIdOrName);
    }
  }
  return withClan(clanIdOrName || getClanId(), action);
}

function withClan<T>(clanIdOrName: string | number, action: () => T): T {
  const startingClanId = getClanId();
  Clan.join(clanIdOrName);
  try {
    return action();
  } finally {
    Clan.join(startingClanId);
  }
}

export class StashManager {
  clanIdOrName: string | number;
  enabled: boolean;
  taken = new Map<Item, number>();

  constructor() {
    const clanIdOrName = get("garbo_stashClan", "none");
    this.clanIdOrName = clanIdOrName.match(/^\d+$/) ? parseInt(clanIdOrName) : clanIdOrName;
    this.enabled = 0 !== this.clanIdOrName && "none" !== this.clanIdOrName;
  }

  take(...items: Item[]): void {
    if (items.length === 0) {
      return;
    }
    if (!this.enabled) {
      print(
        `Stash access is disabled. Ignoring request to borrow "${items
          .map((value) => value.name)
          .join(", ")}" from clan stash.`,
        HIGHLIGHT
      );
      return;
    }
    withClan(this.clanIdOrName, () => {
      for (const item of items) {
        if (have(item)) continue;
        if (getFoldGroup(item).some((fold) => have(fold))) {
          cliExecute(`fold ${item.name}`);
          continue;
        }
        const foldArray = [item, ...getFoldGroup(item)];

        refreshStash();
        for (const fold of foldArray) {
          try {
            if (stashAmount(fold) > 0) {
              if (takeStash(1, fold)) {
                print(`Took ${fold.name} from stash in ${getClanName()}.`, HIGHLIGHT);
                if (fold !== item) cliExecute(`fold ${item.name}`);
                this.taken.set(item, (this.taken.get(item) ?? 0) + 1);
                stashItems.push(fold);
                break;
              } else {
                print(
                  `Failed to take ${
                    fold.name
                  } from the stash. Do you have stash access in ${getClanName()}?`,
                  "red"
                );
              }
            }
          } catch {
            print(`Failed to take ${fold.name} from stash in ${getClanName()}.`, "red");
          }
        }
        if (have(item)) continue;
        print(`Couldn't find ${item.name} in clan stash for ${getClanName()}.`, "red");
      }
    });
  }

  /**
   * Ensure at least one of each of {items} in inventory.
   * @param items Items to take from the stash.
   */
  ensure(...items: Item[]): void {
    this.take(...items.filter((item) => availableAmount(item) === 0));
  }

  putBack(...items: Item[]): void {
    if (items.length === 0) return;
    if (visitUrl("fight.php").includes("You're fighting")) {
      print("In fight, trying to get away to return items to stash...", HIGHLIGHT);
      Macro.if_($monster`Knob Goblin Embezzler`, Macro.attack().repeat())
        .tryItem(...$items`Louder Than Bomb, divine champagne popper`)
        .step("runaway")
        .submit();
    } else if (handlingChoice()) {
      print(
        `I'm stuck in a choice, unfortunately, but were I not, I'd like to return the following items to your clan stash:`,
        "red"
      );
      items.forEach((item) => print(`${item.name},`, "red"));
    }
    withClan(this.clanIdOrName, () => {
      for (const item of items) {
        const count = this.taken.get(item) ?? 0;
        if (count > 0) {
          retrieveItem(count, item);
          if (item === $item`Buddy Bjorn`) {
            visitUrl(`desc_item.php?whichitem=${$item`Buddy Bjorn`.descid}`);
            bjornifyFamiliar($familiar`none`);
          }
          if (item === $item`Crown of Thrones`) {
            visitUrl(`desc_item.php?whichitem=${$item`Crown of Thrones`.descid}`);
            enthroneFamiliar($familiar`none`);
          }
          if (putStash(count, item)) {
            const index = stashItems.indexOf(item);
            if (index >= 0) stashItems.splice(stashItems.indexOf(item), 1);
            print(`Returned ${item.name} to stash in ${getClanName()}.`, HIGHLIGHT);
            this.taken.delete(item);
          } else {
            throw `Failed to return ${item.name} to stash.`;
          }
        }
      }
    });
  }

  /**
   * Put all items back in the stash.
   */
  putBackAll(): void {
    this.putBack(...this.taken.keys());
  }
}
