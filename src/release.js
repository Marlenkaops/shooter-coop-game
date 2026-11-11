export const RELEASE = Object.freeze({
  id: "2026-11-01-wickfall-cemetery",
  title: "Wickfall: the lantern graveyard",
  date: "1 November 2026",
  changes: Object.freeze([
    ["A real graveyard setting", "Wickfall now has original weathered stonework, carved headstones, crypt doorway crowns, inscriptions and paved cemetery paths instead of generic metal boxes and floating sci-fi decorations."],
    ["Lanterns, candles and cobwebs", "Larger lanterns hang over the lanes, crypt entrances glow, and webs cling to solid masonry. More pumpkin and candle clusters sit on nearby cover, not just beyond the far wall."],
    ["Crooked cemetery skyline", "Bare, forked trees and iron cemetery railings frame the moonlit belfry. Tall scenery stays outside the playable boundary and normal doorways, ramps and chest access are unchanged."],
    ["Phone-friendly decoration", "The graveyard keeps its defining scenery on low settings, with instanced props and emissive lighting instead of extra mobile point lights. The decoration toggle and reduced-motion preference still work."],
    ["Faster traversal", "Fixed ground friction canceling your movement. Walking now targets 10 m/s and sprinting 14.8 m/s, with smooth acceleration, braking and normalized diagonal control on desktop and phone."],
    ["Jack-o'-Six", "Find the six-shell copper lantern repeater in Wickfall's western raised vault. Nine-pellet semi-auto volleys hit hard up close; longer shots lose damage."],
    ["Graveglass G9", "Find the nine-round suppressed precision rifle in the eastern raised vault. A spectral 3x prism, quieter report and deliberate semi-auto handling reward accurate shots."],
    ["Fog and low ground mist", "A stronger distance haze and soft, low drifting fog give arenas more atmosphere. Wickfall has denser moonlit mist; mobile effects use a bounded single draw call."],
    ["Event-only equipment", "The event stays open until its end is announced, with no automatic expiry. The Halloween map and guns are available only while the event is active, even for previously collected guns."]
  ])
});
