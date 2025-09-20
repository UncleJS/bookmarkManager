Let's plan together in a markdown file the following app I want to explain.
DO NOT start the work. We wil do planning first in the markdown file and the file needs to be clear enough for any person or AI without context to execute this plan for this project.

Project Overview
We want a bookmark capture Chrome extension tool. That connects to an API to save bookmarks with extra details. This api connects to a mariadb database.

Tech Specifications
- Chrome Extension
    - We want to use the most simple code as possible. I am thinking not using libraries or frameworks. Just pure javascript, html and css except maybe for tailwindcss for css imported via CDN.
    - The extension will have a popup that allows users to capture bookmarks
    - The popup will have a form with the following fields:
        - URL (pre-filled with the current tab URL)
        - Title (pre-filled with the current tab title)
        - Description (text area for user to add extra details)
        - Classification (multiple choice dropdown with grouped options and is pulled from the API) and you can create new classifications on the fly)
        - Tags (needs to be a multi-select dropdown with options pulled from the API and you can create new tags on the fly)
        - Checkboxes for:
            - Read later
            - Hot topic
            - cheatsheets
            - archived
        - Save Button (to submit the form)
    - The extension will have a background script to handle communication with the API
    - The extension will have permissions to access the current tab URL and title
    - The extension will handle form submission and send a POST request to the API with the bookmark details
    - The extension will handle success and error responses from the API and provide user feedback
    - We want to add the ability to right click on the page and have a context menu option to "Quick Save Bookmark" that does not open the popup but saves the bookmark with just the URL and title to the API with default values for the other fields.
    - We want to add the ability to right click on the page and have a context menu option to "Full Save Bookmark" that opens the popup with the form pre-filled with the URL and title.
- Node.js API
    - Node.js API connects to a MariaDB database
