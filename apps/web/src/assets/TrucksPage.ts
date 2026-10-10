/**
 * The Trucks page's frame and its tabs in one file for the router: they load
 * as one chunk, so moving between tabs never waits on a download (#665, as
 * the Money page does, #664).
 */
export { TrucksFrame } from "./TrucksFrame.js";
export { TrucksOverview } from "./TrucksOverview.js";
export { AssetsStub } from "../screens/AssetsStub.js";
