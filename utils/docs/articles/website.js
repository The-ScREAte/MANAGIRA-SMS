"use strict";

// School website: the public site, its designs, sections, photos, news and messages.
// Pictures: public/images/docs/website-*.webp (taken by ~/.managira-local-copy/tools/docshots/scripts/website-*.js;
// visitor pictures use the sample school's public address).
const WHO = "Managers, and staff given <strong>Manage Organization Settings › School website</strong> (on plans that include the school website).";

module.exports = [
  {
    slug: "school-website",
    title: "Your school website: open it, check it and see what visitors see",
    topic: "School website",
    order: 1,
    summary: "Every school gets a public website on its own address, built from what you already keep in Managira. Learn where to manage it and what visitors see.",
    tags: ["school website", "public website", "web address", "view website", "own website", "website setup", "mobile website", "online admission", "contact form"],
    featured: true,
    who: WHO,
    intro: "Your school website lives at your own address, for example <code>yourschool.managira.com</code>. It is built from your logo, contact details, events and announcements, plus the sections, photos and news you add. It works on phones and computers.",
    sections: [
      {
        title: "Open School website",
        image: "website-manage.webp",
        caption: "Management › School website: Website setup at the top, then a panel for each part.",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>School website</strong> in the menu on the left."],
          ["<strong>Website setup</strong> shows how far along you are, for example <em>6/6</em>. Each tile (<strong>About</strong>, <strong>Phone &amp; email</strong>, <strong>Photos</strong>, <strong>Sections</strong>, <strong>Contact form</strong>, <strong>Design</strong>, <strong>News</strong>, <strong>Online admission</strong>) says what is done. Select one to jump to its panel."],
          "Under the setup tiles are the panels: <strong>Website design</strong>, <strong>Light or dark</strong>, <strong>Photos &amp; videos</strong>, <strong>News</strong>, <strong>Online admission</strong>, <strong>Page Sections &amp; Order</strong>, <strong>About &amp; contact details</strong>, <strong>Contact Form &amp; Messages</strong> and <strong>Website Sections</strong>. Open or close a panel with the arrow at its right.",
        ],
      },
      {
        title: "View your website",
        steps: [
          ["Select <strong>View website</strong> at the top right. Your site opens in a new tab, as a visitor sees it."],
        ],
        tip: "Open it signed out, or on your phone, to see what families see.",
      },
      {
        title: "What visitors see",
        list: [
          "Your school name, logo, motto and photos, with <strong>Apply now</strong> and <strong>Contact us</strong> buttons.",
          "A banner with <strong>Start application</strong> while online admission is open. See <a href=\"/legal/user-documentation/online-admission\">Online admission</a>.",
          "Quick facts, your welcome, programs, admissions steps, the photo gallery, news, leadership, achievements, what families say, questions and answers, and a contact form. A section with nothing in it stays hidden.",
          "Events and announcements you choose to publish to the website. Manage them in <a href=\"/legal/user-documentation/events-announcements-notifications\">Events, announcements &amp; activities</a>.",
        ],
      },
      {
        title: "On a phone",
        images: [["website-visitor-phone.webp", "The same site on a phone. The menu moves to the bottom."], ],
        text: "The site fits any screen. On a phone the header keeps your logo at the left and Sign In at the right, and the menu (Gallery, Articles, About, Contact) sits along the bottom.",
      },
      {
        title: "Use your own website instead",
        steps: [
          ["Select <strong>Use my own website</strong> at the top right.", "website-own-address.webp", "Enter the address families should visit."],
          "Type your website's address in <strong>Website URL</strong>, for example <code>https://www.yourschool.edu</code>, and select <strong>Save address</strong>. Families who select your school website are sent there.",
          "The button then reads <strong>Website address</strong>. Open it and select <strong>Use Managira website</strong> to switch back.",
        ],
      },
    ],
    faq: [
      ["Can we use our own domain name?", "Your Managira website stays at your Managira address. If you already have your own website, use <strong>Use my own website</strong> to send families to it."],
      ["Will search engines find us?", "Yes. Each school website is listed for search engines with your school's name, description and location. A short <strong>About</strong> text helps."],
      ["Why is a section missing on the site?", "A section shows only when it is switched on and has something in it. Check <a href=\"/legal/user-documentation/school-website-content\">Edit your website's sections and photos</a>."],
    ],
    related: ["school-website-designs", "school-website-content", "school-website-contact-messages", "online-admission", "customize-your-school"],
  },
  {
    slug: "school-website-designs",
    title: "Choose a website design: standard, 3D or emblem",
    topic: "School website",
    order: 2,
    summary: "Pick one of 15 designs, preview it, set light or dark and choose the emblem for emblem designs. Photos are always shown whole.",
    tags: ["website design", "website template", "3d website", "emblem", "mascot", "watermark", "light or dark", "dark mode website", "school website theme", "preview design"],
    who: WHO,
    intro: "Every design shows the same content, so you can switch at any time without retyping anything. Designs come in three groups.",
    sections: [
      {
        title: "Pick a design",
        image: "website-design-picker.webp",
        caption: "Website design: Standard (9), 3D (4) and Emblem (2).",
        steps: [
          "Go to <strong>Management › School website</strong> and open <strong>Website design</strong>.",
          ["Choose a tab: <strong>Standard</strong>, <strong>3D</strong> or <strong>Emblem</strong>. The number beside each tab is how many designs it holds."],
          ["Select a design card. The one in use is marked <strong>Current</strong>."],
          "Select <strong>Preview</strong> on a card to see it as a visitor would, in a new tab, before you choose it.",
          ["Select <strong>Save design</strong>. The website changes at once."],
        ],
      },
      {
        title: "Standard designs",
        text: "Clean, classic pages. Select <strong>Preview</strong> on a design's card to see it with your own content. Two of them, from the sample school, are shown here.",
        table: [
          ["Design", "Looks like"],
          ["<strong>Academy</strong>", "A full-screen opening, next steps and big numbers."],
          ["<strong>Classic</strong>", "A wide photo banner and centered sections."],
          ["<strong>Modern</strong>", "Your welcome beside your photos, in clean cards."],
          ["<strong>Magazine</strong>", "A newspaper look with a lead story."],
          ["<strong>Story</strong>", "A large photo opening and numbered chapters."],
          ["<strong>Campus</strong>", "A side menu with your school's details."],
          ["<strong>Spotlight</strong>", "A bold welcome in your color beside your photos."],
          ["<strong>Minimal</strong>", "Quiet and text-first."],
          ["<strong>Mosaic</strong>", "A grid of tiles: photos, facts and news."],
        ],
        images: [
          ["website-design-magazine.webp", "Magazine"],
          ["website-design-campus.webp", "Campus"],
          ],
      },
      {
        title: "3D designs",
        text: "These move smoothly as visitors scroll. Visitors who have asked their device to reduce motion see them still, and nothing is ever hidden behind the animation.",
        table: [
          ["Design", "Looks like"],
          ["<strong>Glide</strong>", "Calm and simple. Your photo tilts into place as visitors scroll."],
          ["<strong>Prism</strong>", "Glass panels, a 3D photo stack and a photo wall that straightens."],
          ["<strong>Panorama</strong>", "Full-screen scenes and a gallery that sweeps sideways."],
          ["<strong>Orbit</strong>", "Your emblem floats in 3D behind glass and turns as visitors scroll. It uses your emblem."],
        ],
        images: [
          ["website-design-glide.webp", "Glide"],
          ],
      },
      {
        title: "Emblem designs and your emblem",
        text: "Emblem designs use your mascot or symbol as a soft watermark.",
        table: [
          ["Design", "Looks like"],
          ["<strong>Crest</strong>", "Your emblem large behind the school's name, with a soft pattern."],
          ["<strong>Mascot</strong>", "A bold welcome in your color with your mascot beside it."],
        ],
        images: [],
        steps: [
          ["Open the <strong>Emblem</strong> tab. <strong>Your emblem</strong> appears under the designs."],
          ["Choose <strong>Mascots &amp; symbols</strong> (lion, eagle, owl, bear, wolf, fox, bull, wildcat, open book, graduation cap, star, oak tree, torch, shield, crown, atom, bell, lighthouse, mountain or anchor), your <strong>School logo</strong>, or <strong>Your image</strong>.", "website-emblem-zoom.webp", "Shield is chosen. A small preview shows the result."],
          "Choose <strong>Pattern</strong> for a soft repeat or <strong>One large emblem</strong>.",
          "Select <strong>Save design</strong>. The emblem is drawn in your school color.",
        ],
        tip: "For <strong>Your image</strong>, a PNG with a clear background works best. Orbit, in the 3D group, uses the same emblem.",
      },
      {
        title: "Light or dark",
        steps: [
          ["Open <strong>Light or dark</strong>, choose <strong>Light</strong> (bright pages in your school colors) or <strong>Dark</strong>, and select <strong>Save</strong>."],
        ],
      },
      {
        title: "Photos are always shown whole",
        text: "Managira never crops your photos. A photo whose shape fits its frame fills it. One that does not, such as a wide photo in a tall frame, is shown in full over a soft, blurred copy of itself, so nothing important is cut off. Words laid over photos follow the photo behind them, so they stay easy to read.",
      },
    ],
    faq: [
      ["Will I lose anything if I change design?", "No. Every design shows the same content. Your sections, photos and news carry over."],
      ["Can visitors choose light or dark?", "You choose what visitors see in <strong>Light or dark</strong>. People who are signed in to Managira keep their own choice."],
    ],
    related: ["school-website", "school-website-content", "customize-your-school"],
  },
  {
    slug: "school-website-content",
    title: "Edit your website's sections, photos and news",
    topic: "School website",
    order: 3,
    summary: "Fill in About, quick facts, welcome, programs and more, add photos and news, and arrange the page in the order you choose.",
    tags: ["website sections", "website photos", "gallery", "slideshow", "news", "articles", "page order", "about us", "motto", "quick facts", "faq", "testimonials", "school website content"],
    who: WHO,
    intro: "Everything on your website comes from a few panels in Management › School website: your About text and contact details, photos, news and the sections of the page. Fill in what you have; a section with nothing in it stays hidden.",
    sections: [
      {
        title: "About and contact details",
        steps: [
          ["Open <strong>About &amp; contact details</strong>. Write <strong>About your school</strong> and the <strong>Motto</strong>."],
          "Under <strong>Emails on the website</strong> and <strong>Phones on the website</strong>, enter each address and number. Use <strong>+ Add email</strong> or <strong>+ Add phone</strong> for more, and <strong>Remove</strong> to take one away.",
          ["Select <strong>Save</strong>."],
        ],
      },
      {
        title: "Photos and videos",
        image: "website-photos.webp",
        caption: "Photos & videos: the slideshow at the top of the site, then the gallery.",
        steps: [
          ["Open <strong>Photos &amp; videos</strong> and select <strong>Add photos or videos</strong>."],
          ["Choose <strong>Content Type</strong>: <strong>Slideshow (top of the website)</strong> or <strong>Gallery</strong>. Pick your files and add a caption for each, then select <strong>Upload</strong>."],
          "Each photo then has its own <strong>Caption</strong>, <strong>Allocation</strong> (<strong>Slideshow Image</strong> or <strong>Gallery Image</strong>) and <strong>Save</strong>. Change them any time.",
        ],
        note: "Photos and videos are made smaller automatically so the website loads fast. Videos are converted to 720p, up to 3 minutes and 300 MB per file. Portrait photos are still shown whole, never cropped.",
        tip: "Use bright, landscape photos for the slideshow.",
      },
      {
        title: "News articles",
        image: "website-news.webp",
        caption: "News: three articles, newest first on the site.",
        steps: [
          ["Open <strong>News</strong> and select <strong>Add article</strong>."],
          "Type a <strong>Heading</strong>, write the <strong>Article</strong> in the editor and select <strong>Add Article</strong>.",
          "To change or remove an article, edit it in the same panel and select <strong>Save</strong>, or delete it.",
        ],
        example: "<em>Fall Concert on December 10</em>: the 6th to 8th grade bands and choir perform at 6:30 PM in the gymnasium. Doors open at 6:00 PM, and every family is welcome.",
      },
      {
        title: "Website sections",
        image: "website-sections.webp",
        caption: "Website Sections: each card has a Show on website switch and a Save button.",
        text: "Open <strong>Website Sections</strong> to fill in the cards below. A section shows once it is switched on and has something in it.",
        table: [
          ["Section", "What to put in it"],
          ["School Banner", "A small line above the school name and a tagline. The name and logo come from your school settings."],
          ["Quick Facts", "Big numbers, for example <em>420 students</em> or <em>14:1 students per teacher</em>."],
          ["Programs &amp; Facilities", "What you offer, each with a photo."],
          ["Leadership", "Your head of school and leaders."],
          ["Testimonials", "Kind words from parents, students and alumni."],
          ["Welcome Message", "A welcome from your head of school, with a photo."],
          ["Admissions", "How to join, step by step."],
          ["Achievements &amp; Awards", "Awards and milestones by year."],
          ["FAQ", "Answers to what families ask most."],
          ["Contact Form", "Your contact form, address and office hours. See <a href=\"/legal/user-documentation/school-website-contact-messages\">The contact form and its messages</a>."],
          ["Social Media", "Links to your school's pages such as Facebook and Instagram."],
        ],
        steps: [
          "Check <strong>Show on website</strong> for the section.",
          "Fill in its items. Use <strong>+ Add</strong> for another item, and the arrows to move items up and down or the <strong>✕</strong> to remove one.",
          "Select <strong>Save</strong> on that card. The website updates straight away.",
        ],
      },
      {
        title: "Arrange the page",
        image: "website-order.webp",
        caption: "Page Sections & Order: each section, whether it is live, and its heading.",
        steps: [
          ["Open <strong>Page Sections &amp; Order</strong>. Each row is a part of the page and says <strong>Live</strong> or <strong>Nothing added yet</strong>."],
          "Rename a heading in its box, check or uncheck <strong>Show</strong>, and use ▲ and ▼ to move a row. <strong>Edit</strong> takes you to that section's panel, and <strong>Manage</strong> beside Events and Announcements opens Events, announcements &amp; activities.",
          ["Select <strong>Save order</strong>. <strong>Default order</strong> puts everything back as it was."],
        ],
        note: "Events and announcements marked public appear on the website by themselves.",
      },
    ],
    faq: [
      ["I saved a section but visitors don't see it.", "Check that <strong>Show on website</strong> is checked, that the section has at least one item, and that it is not hidden in <strong>Page Sections &amp; Order</strong>."],
      ["How do I change the logo or school color?", "Those come from <a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>."],
    ],
    related: ["school-website", "school-website-designs", "school-website-contact-messages", "events-announcements-notifications"],
  },
  {
    slug: "school-website-contact-messages",
    title: "The contact form and its messages",
    topic: "School website",
    order: 4,
    summary: "Turn on the contact form, choose where messages are emailed, and read, answer and archive messages from visitors.",
    tags: ["contact form", "website messages", "inbox", "visitor messages", "reply", "archive", "contact us", "office hours", "map"],
    who: WHO,
    intro: "Visitors can write to your school from the website. Every message is emailed to the address you choose and also kept in Managira.",
    sections: [
      {
        title: "Set up the contact form",
        image: "website-contact.webp",
        caption: "Contact Form & Messages: the form's settings, then the inbox.",
        steps: [
          "Open <strong>Contact Form &amp; Messages</strong> in <strong>Management › School website</strong>.",
          "Check <strong>Show the contact form on the website</strong>.",
          "Choose where messages are emailed in <strong>Send messages to</strong>. It lists your school's emails, or choose <strong>Another email...</strong>.",
          "Fill in the <strong>Section heading</strong>, an optional <strong>Intro</strong>, your <strong>Address</strong> and <strong>Office hours</strong>. Check <strong>Show a map of the address</strong> if you want a map.",
          "Select <strong>Save</strong>.",
        ],
      },
      {
        title: "What visitors see",
        text: "Visitors enter their name, email, an optional phone and subject, and a message. A short check confirms they are a person, and nothing needs clicking. Their message reaches you right away.",
      },
      {
        title: "Read and answer messages",
        steps: [
          ["Under <strong>Messages from your website</strong>, use <strong>Inbox</strong>, <strong>Unread</strong> and <strong>Archived</strong> to switch between lists."],
          "A red number beside <strong>Contact Form &amp; Messages</strong> and a note in Website setup show how many are new.",
          "On a message, select <strong>Reply</strong> to answer by email, <strong>Mark as read</strong> when you have seen it, or <strong>Archive</strong> to tidy it away. <strong>Restore</strong> brings an archived message back.",
        ],
      },
    ],
    faq: [
      ["Do I get an email as well?", "Yes. Each message is emailed to the address in <strong>Send messages to</strong> and is also kept in Messages."],
      ["Spam?", "Visitors must pass a short automatic check before they can send, which keeps most spam out."],
    ],
    related: ["school-website", "school-website-content"],
  },
];
