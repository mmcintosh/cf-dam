/**
 * Library facets: what a photo shows, asked of TypeSafe's Jev in one request (facets.ts). Copied word for word from
 * jev-photolab (facets/questions.mjs at 2e27e29), where each question was measured on 805 holdout photos; a change in
 * wording needs measuring there again (`npm run facets:holdout`), and test/facets.test.ts pins this text.
 * A facet can be true alongside any other (a person with a dog on a beach), so each subject is its own Noul.
 */
export interface Question {
  type: 'noul' | 'choice' | 'score' | 'box'
  instructions: string
  criteria?: Record<string, string>
}

export const FACETS: Record<string, Question> = {
  // People
  person: { type: 'noul', instructions: 'Is there a person in `image`?', criteria: { true: 'A person can be seen, even far away or in a crowd. A face alone counts.', false: 'No one can be seen, or only a hand, feet or another small part of someone. Statues and paintings of people do not count.' } },
  people_count: { type: 'choice', instructions: 'How many people can be seen in `image`?', criteria: { one: 'One person.', two_to_five: 'Two, three, four or five people.', six_or_more: 'Six people or more, such as a group, a team or a crowd.' } },
  child: { type: 'noul', instructions: 'Is there a child in `image`?', criteria: { true: 'A baby or a child of primary-school age or younger can be seen.', false: 'No one in the image is a child: only teenagers and adults, or no people at all.' } },
  // Living things
  animal: { type: 'noul', instructions: 'Is there an animal in `image`, such as a pet, a farm animal, a wild animal, a bird, a fish or an insect?', criteria: { true: 'A real, living animal can be seen.', false: 'No animals, or only toys, statues or pictures of animals.' } },
  bird: { type: 'noul', instructions: 'Is there a bird in `image`?' },
  flower: { type: 'noul', instructions: 'Are there flowers in `image`?' },
  // Things
  food: { type: 'noul', instructions: 'Is there food in `image`?', criteria: { true: 'Food can be seen: a meal, a snack, fruit, vegetables, bread or a cake.', false: 'No food can be seen. Drinks alone do not count.' } },
  building: { type: 'noul', instructions: 'Is there a building in `image`?', criteria: { true: 'A building can be seen from outside, such as a house, a tower, a church or an office block.', false: 'No building is seen from outside, such as a photo taken inside a room, or of open countryside.' } },
  vehicle: { type: 'noul', instructions: 'Is there a vehicle in `image`, such as a car, a bicycle, a boat, a train or a plane?' },
  text: { type: 'noul', instructions: 'Is there writing in `image`, such as words on a sign, a shirt, a label or a page?' },
  // Places and scenes
  water: { type: 'noul', instructions: 'Is there a body of water in `image`, such as the sea, a lake, a river or a pool?' },
  snow: { type: 'noul', instructions: 'Is there snow or ice in `image`?' },
  mountain: { type: 'noul', instructions: 'Are there mountains or hills in `image`?' },
  landscape: { type: 'noul', instructions: 'Is `image` a landscape?', criteria: { true: 'A wide view of countryside, mountains, the coast or a city, where the place itself is the subject.', false: 'The photo is of a person, an animal, an object or a detail, even if there is scenery behind it.' } },
  sport: { type: 'noul', instructions: 'Does `image` show people playing a sport?' },
  setting: { type: 'choice', instructions: 'Was `image` taken indoors or outdoors?', criteria: { indoors: 'Inside a building or a vehicle.', outdoors: 'Outside, in the open air.' } },
  night: { type: 'noul', instructions: 'Was `image` taken outdoors at night?', criteria: { true: 'It is dark outside: a night sky, street lights, lit windows or fireworks.', false: 'It is daytime or dusk with a bright sky, or the photo was taken indoors.' } },
  // The picture itself
  medium: { type: 'choice', instructions: 'What kind of image is `image`?', criteria: { photograph: 'A photograph taken with a camera.', painting_or_drawing: 'A painting or a drawing made by hand.', print_or_engraving: 'A printed picture such as an engraving, woodcut, lithograph or poster.', digital_graphic: 'A screenshot, diagram, logo or computer-made illustration.' } },
  monochrome: { type: 'noul', instructions: 'Is `image` black and white, or sepia?' },
}

/** The yes/no facets that become tags, in display order (labels live in the i18n catalogs as `facet.<id>`). */
export const TAG_FACETS = ['person', 'child', 'animal', 'bird', 'flower', 'food', 'building', 'vehicle', 'text', 'water', 'snow', 'mountain', 'landscape', 'sport', 'night', 'monochrome'] as const
export type TagFacet = (typeof TAG_FACETS)[number]
