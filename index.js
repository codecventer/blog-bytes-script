import { Configuration, OpenAIApi } from "openai";
import { createClient, SanityClient } from "@sanity/client";
import { createApi } from "unsplash-js";
import Twitter from "twitter-lite";
import snoowrap from "snoowrap";
import AWS from "@aws-sdk/client-ses";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
dotenv.config();

export const handler = async (event, context, callback) => {
  let response;

  // formatted current date for latest Sanity.io API
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  function padTo2Digits(num) {
    return num.toString().padStart(2, "0");
  }

  function formatDate(date) {
    return [
      date.getFullYear(),
      padTo2Digits(date.getMonth() + 1),
      padTo2Digits(date.getDate()),
    ].join("-");
  }

  // date variables for Chat-GPT and Sanity.io document
  const currentDate = new Date();
  const startDate = new Date(currentDate.getFullYear(), 0, 1);
  const days = Math.floor((currentDate - startDate) / (24 * 60 * 60 * 1000));

  const yearNumber = currentDate.getFullYear();
  const weekNumber = Math.ceil(days / 7);

  // title and hashtag variables for image search, Twitter, Reddit and Sanity.io document
  let postKeyword;
  let postHashtag;
  let postTitle;
  let postSlug;
  let postIntro;
  let postBody;
  let postCoverImage;
  let postUrl;
  const siteUrl = process.env.SITE_URL;

  // email field variables
  let emailSubject;
  let emailBody;
  let postedSubReddits = [];
  let failedSubReddits = [];

  // OpenAI client
  class OpenAI {
    constructor(apiKey) {
      this.openai = new OpenAIApi(new Configuration({ apiKey }));
    }
    async generateText(prompt, model, max_tokens, temperature = 0.85) {
      try {
        const response = await this.openai.createCompletion({
          model,
          prompt,
          max_tokens,
          n: 1,
          temperature,
        });
        return response.data.choices[0].text;
      } catch (error) {
        console.error(error);
        throw error;
      }
    }
  }

  // Unsplash client
  class Unsplash {
    constructor(accessKey) {
      this.unsplash = createApi({ accessKey, fetch });
    }
    async getUnsplashPhoto(
      query,
      page = 1,
      per_page = 8,
      orientation = "landscape"
    ) {
      try {
        const response = await this.unsplash.search.getPhotos({
          query,
          page,
          per_page,
          orientation,
        });
        const randomPhoto =
          response.response.results[Math.floor(Math.random() * 8)];
        const photoUrl = randomPhoto.urls.regular;
        const photo = await fetch(photoUrl);
        const photoBuffer = await photo.arrayBuffer();
        const image = Buffer.from(photoBuffer);
        postCoverImage = image;
      } catch (error) {
        console.error(error);
        throw error;
      }
    }
  }

  //CHAT-GPT API: GENERATE KEYWORD, HASHTAG, TITLE AND POST BODY
  const chatGpt = async () => {
    const openAI = new OpenAI(process.env.OPENAI_API_KEY);
    const model = "text-davinci-003";
    const topic = `Generate a keyword, hashtag, title and 400 word article about a trending topic in week ${weekNumber} of ${yearNumber} in the following format: "Keyword:" "Hashtag:" "Title:" "Article:"`;

    const generatePrompt = (topic) => {
      return topic;
    };

    await openAI
      .generateText(generatePrompt(topic), model, 800)
      .then((responseText) => {
        // keyword
        if (responseText.includes("Keyword:")) {
          const keywordIndex = responseText.indexOf("Keyword:") + 8;
          const endOfKeywordIndex = responseText.indexOf("\n", keywordIndex);
          const testKeyword = responseText
            .substring(keywordIndex, endOfKeywordIndex)
            .trim();
          postKeyword = testKeyword;
        } else {
          const words = responseText.split(" ");
          const firstWord = words[0].trim();
          postKeyword = firstWord;
        }

        // hashtag
        if (responseText.includes("Hashtag:")) {
          const hashtagMatch = responseText.match(/Hashtag:(.*?)Title:/s);
          if (hashtagMatch) {
            postHashtag = hashtagMatch[1].trim();
          } else {
            postHashtag = "";
          }
        } else {
          const hashtag = responseText.match(/#\w+/g);
          postHashtag = hashtag;
        }

        // title
        const titleIndex = responseText.indexOf("Title:") + 6;
        const endOfTitleIndex = responseText.indexOf("\n", titleIndex);
        const testTitle = responseText
          .substring(titleIndex, endOfTitleIndex)
          .trim();
        postTitle = testTitle.replace(/"/g, "");

        // slug
        const cleanedText = postTitle
          .replace(/[^\w\s]/g, "")
          .replace(/\s+/g, "-")
          .toLowerCase();
        postSlug = cleanedText;
        postUrl = siteUrl + postSlug;

        // article
        if (responseText.includes("Article:")) {
          const articleIndex = responseText.indexOf("Article:") + 8;
          const testArticle = responseText.substring(articleIndex).trim();
          postBody = testArticle;
        } else {
          const titleIndex = responseText.indexOf("Title: ");
          const restOfText =
            titleIndex !== -1
              ? responseText.substring(titleIndex + "Title: ".length).trim()
              : "";
          postBody = restOfText;
        }

        // intro
        const specificText = postTitle;
        const paragraphs = postBody.split("\n\n");
        const index = paragraphs.findIndex((paragraph) =>
          paragraph.includes(specificText)
        );
        const firstParagraph = paragraphs[index + 1];
        postIntro = firstParagraph;
      })
      .then(() => {
        console.log("ChatGPT succeeded");
      })
      .catch((error) => {
        console.error(error);
        throw error;
      });
  };

  //Unsplash
  const unsplash = async () => {
    const unsplash = new Unsplash(process.env.UNSPLASH_KEY);
    await unsplash
      .getUnsplashPhoto(postKeyword)
      .then(() => {
        console.log("Unsplash succeeded");
      })
      .catch((error) => {
        console.error(error);
      });
  };

  //Sanity.io
  const sanity = async () => {
    const sanityClient = createClient({
      projectId: process.env.SANITY_PROJECT_ID,
      dataset: process.env.SANITY_DATASET,
      useCdn: false,
      apiVersion: formatDate(new Date()),
      token: process.env.SANITY_NODE_KEY,
    });

    // upload image asset
    await sanityClient.assets
      .upload("image", postCoverImage, { filename: "image" })
      .then(async (imageAsset) => {
        // set document field values
        const postId = await generateUUID();
        const doc = {
          _type: "post",
          title: postTitle,
          slug: { _type: "slug", current: postSlug },
          content: [
            {
              children: [
                {
                  text: postBody,
                  _key: "e44a363c3129",
                  _type: "span",
                },
              ],
              _type: "block",
              _key: postId,
              markDefs: [],
            },
          ],
          excerpt: postIntro,
          date: currentDate,
        };

        // create document and update image field
        await sanityClient.create(doc).then((response) => {
          return sanityClient
            .patch(response._id)
            .set({
              coverImage: {
                _type: "image",
                asset: { _type: "reference", _ref: imageAsset._id },
              },
              author: {
                _ref: "cf02e464-f626-4dfb-a88d-54f5dbc53116",
                _type: "reference",
              },
            })
            .commit();
        });
      })
      .then(() => {
        console.log("Sanity.io succeeded");
      })
      .catch((error) => {
        console.error(error);
      });
  };

  async function generateUUID() {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let uuid = "";
    for (let i = 0; i < 19; i++) {
      uuid += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return uuid;
  }

  //TWITTER: TWEET
  const twitter = async () => {
    const twitterClient = new Twitter({
      consumer_key: process.env.TWITTER_APP_KEY,
      consumer_secret: process.env.TWITTER_APP_SECRET,
      access_token_key: process.env.TWITTER_ACCESS_TOKEN,
      access_token_secret: process.env.TWITTER_ACCESS_SECRET,
    });
    const tweet = `${postTitle} ${postHashtag} ${process.env.SITE_HASHTAG} ${postUrl}`;
    await twitterClient
      .post("statuses/update", { status: tweet })
      .then(() => {
        console.log("Twitter succeeded");
      })
      .catch((error) => {
        console.error(error);
        throw error;
      });
  };

  //REDDIT: POST(S)
  const reddit = async () => {
    const redditClient = new snoowrap({
      userAgent: "Whatever",
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      username: process.env.REDDIT_USERNAME,
      password: process.env.REDDIT_PASSWORD,
    });

    // list of subreddits
    const subRedditList = [
      "Blogging",
      "BlogExchange",
      "Bloggers",
      "BloggersCommunity",
      "bloggersandreaders",
      "blogger",
      "blogs",
    ];

    // add randomly picked subreddits to list
    const selectedSubReddits = [
      process.env.REDDIT_SUBREDDIT,
      subRedditList[Math.floor(Math.random() * 3)], // 0 - 2
      subRedditList[Math.floor(Math.random() * 3) > 1 ? 3 : 4], // 3 - 4
      subRedditList[Math.floor(Math.random() * 3) > 1 ? 5 : 6], // 5 - 6
    ];

    for (const subReddit of selectedSubReddits) {
      if (await subredditExists(subReddit, redditClient)) {
        if (subReddit === process.env.REDDIT_SUBREDDIT) {
          await redditClient
            .getSubreddit(subReddit)
            .submitLink({
              title: postTitle,
              url: postUrl,
              sendReplies: true,
            })
            .then(async (submission) => {
              await submission.approve();

              postedSubReddits.push(subReddit);
              console.log(`Reddit - posted to ${subReddit}`);
            })
            .catch((error) => {
              failedSubReddits.push(subReddit + " - " + error);
              console.error(
                `Error occured trying to post to ${subReddit} - ` + error
              );
            });
        } else {
          await redditClient
            .getSubreddit(subReddit)
            .submitLink({
              title: postTitle,
              url: postUrl,
              sendReplies: true,
            })
            .then(() => {
              postedSubReddits.push(subReddit);
              console.log(`Reddit - posted to ${subReddit}`);
            })
            .catch((error) => {
              failedSubReddits.push(subReddit + " - " + error);
              console.error(
                `Error occured trying to post to ${subReddit} - ` + error
              );
            });
        }
      } else {
        failedSubReddits.push(`Reddit - ${subReddit} does not exist`);
      }
    }
  };

  async function subredditExists(subredditName, snoowrapInstance) {
    try {
      const subreddit = await snoowrapInstance
        .getSubreddit(subredditName)
        .fetch();
      return subreddit.display_name === subredditName;
    } catch (error) {
      return false;
    }
  }

  //AWS SES: SEND EMAIL
  const ses = async () => {
    const SES_CONFIG = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    };
    const sesClient = new AWS.SES(SES_CONFIG);

    // format subreddit list
    const emailSubRedditSuccess = postedSubReddits.join(", ");
    const emailSubRedditFailed = failedSubReddits.join("\n");

    emailSubject = `${process.env.SITE_NAME} - ${postTitle}`;
    emailBody = `Good day, ${process.env.ADMIN_USER},</br></br>
    A new ${process.env.SITE_NAME} article was successfully posted with the following field values:</br></br>
    Keyword: ${postKeyword}</br>
    Hashtag: ${postHashtag}</br>
    Title: ${postTitle}</br>
    Slug: ${postSlug}</br>
    Post URL: ${postUrl}</br></br>
    Posted Subreddits: ${emailSubRedditSuccess}</br></br>
    Failed Subreddits:</br>${emailSubRedditFailed}</br></br>
    Intro:</br>${postIntro}</br></br>
    Article:</br>${postBody}</br></br>`;

    const params = {
      Destination: {
        ToAddresses: [process.env.ADMIN_EMAIL],
      },
      Message: {
        Body: {
          Html: {
            Data: emailBody,
          },
        },
        Subject: {
          Data: emailSubject,
        },
      },
      Source: process.env.ADMIN_EMAIL,
    };

    await sesClient
      .sendEmail(params)
      .then(() => {
        console.log("SES succeeded");
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const executeParallel = async () => {
    await Promise.allSettled([
      await chatGpt(),
      await unsplash(),
      await sanity(),
      await twitter(),
      await reddit(),
    ])
      .then(async () => {
        await ses();
        response = {
          statusCode: 200,
          body: JSON.stringify("Success"),
        };
      })
      .catch((error) => {
        response = {
          statusCode: 400,
          body: JSON.stringify(`Error: ${error}`),
        };
      });
  };
  await executeParallel();
  return response;
};

// local execution only
// handler();
