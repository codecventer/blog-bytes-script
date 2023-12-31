# BlogBytes Script

The motivation behind this project was to completely automate a fully functional blog site. You can create your own blog by using the following Next.js template:
https://vercel.com/templates/next.js/blog-nextjs-sanity

This script allows you to:

- Generate an article using **ChatGPT** about a popular topic in the current week
- Fetch a related image from **Unsplash** to use as a cover image
- Post the article with its related cover image to a **Sanity.io** dataset
- Post the article URL to **Twitter**
- Post the article URL to your own sub-reddit and related sub-reddits
- Send an email notification of the new article to the admin user

This script can be executed as a scheduled AWS Lambda function in order to run the script on a daily basis.
## Tech Stack

**Clients:** ChatGPT, Unsplash, Sanity.io, Twitter, Reddit, AWS SES


## Usage/Examples
Clone the repo:
```
git clone https://github.com/codecventer/blog-bytes-script.git
```

**Insert your own API keys and secret keys in .env**

Navigate to project:
```
cd blog-bytes-script
```

Install packages:
```
npm install
```

Uncomment (l.470):
```
// local execution only
// handler();
```

Run the script:
```
node index.js
```
## Authors

- [Christiaan Venter](https://github.com/codecventer)
