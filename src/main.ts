import { QueryBuilder, VariablesBuilder, execute } from "./anilist.js";
import { displayImageFromUrl } from "./image.js";

const query = new QueryBuilder("GetAnime")
  .field("Media", { id: "id", type: "type" }, (media) =>
    media
      .field("coverImage", (coverImage) => coverImage.select("medium"))
      .field("title", (title) => title.select("english")),
  )
  .build();

const variables = new VariablesBuilder()
  .set("id", 1)
  .set("type", "ANIME")
  .build();

const result = await execute(query, variables);
console.log(result.Media?.title?.english);

const imageToDisplay = result.Media?.coverImage?.medium ?? "";
if (imageToDisplay) {
  displayImageFromUrl(imageToDisplay);
} else {
  console.log("No cover image available.");
}
