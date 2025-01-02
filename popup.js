const searchButton = document.getElementById('search-button');
    const searchResultsDiv = document.getElementById('search-results');
    
    searchButton.addEventListener('click', () => {
      const searchQuery = document.getElementById('search-query').value;
      searchEmails(searchQuery);
    });
    
    async function searchEmails(query) {
      searchResultsDiv.innerHTML = 'Searching...';
      try {
        const accessToken = await getAccessToken();
        const emails = await fetchEmails(accessToken);
        const results = await processEmailsWithGemini(emails, query);
        displayResults(results);
      } catch (error) {
        searchResultsDiv.innerHTML = `Error: ${error.message}`;
      }
    }
    
    async function getAccessToken() {
      return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, function(token) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(token);
          }
        });
      });
    }
    
    async function fetchEmails(accessToken) {
      let allEmails = [];
      let nextPageToken = null;
    
      do {
        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
    
        if (!response.ok) {
          throw new Error(`Failed to fetch emails: ${response.status} ${response.statusText}`);
        }
    
        const data = await response.json();
        if (data.messages) {
          const emailDetails = await Promise.all(data.messages.map(async (message) => {
            const emailResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=full`, {
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            });
            if (!emailResponse.ok) {
              console.error(`Failed to fetch email details for message ID ${message.id}: ${emailResponse.status} ${emailResponse.statusText}`);
              return null;
            }
            const emailData = await emailResponse.json();
            return emailData;
          }));
          allEmails = allEmails.concat(emailDetails.filter(email => email !== null));
        }
        nextPageToken = data.nextPageToken;
      } while (nextPageToken);
    
      return allEmails;
    }
    
    async function processEmailsWithGemini(emails, query) {
      const geminiResults = [];
      for (const email of emails) {
        const emailBody = getEmailBody(email);
        if (emailBody) {
          const geminiResponse = await callGeminiAPI(emailBody, query);
          if (geminiResponse && geminiResponse.includes("true")) {
            geminiResults.push({
              id: email.id,
              snippet: email.snippet,
              body: emailBody
            });
          }
        }
      }
      return geminiResults;
    }
    
    function getEmailBody(email) {
      if (email.payload && email.payload.parts) {
        for (const part of email.payload.parts) {
          if (part.mimeType === 'text/plain' && part.body && part.body.data) {
            return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
          }
        }
      } else if (email.payload && email.payload.body && email.payload.body.data) {
        return atob(email.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
      return null;
    }
    
    async function callGeminiAPI(emailBody, query) {
      const geminiAPIKey = 'YOUR_GEMINI_API_KEY';
      const geminiAPIUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + geminiAPIKey;
      const prompt = `Given the email content: "${emailBody}". Does this email contain information related to: "${query}"? Answer with "true" or "false" only.`;
      
      try {
        const response = await fetch(geminiAPIUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }]
          }),
        });
    
        if (!response.ok) {
          console.error(`Gemini API error: ${response.status} ${response.statusText}`);
          return null;
        }
    
        const data = await response.json();
        if (data && data.candidates && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) {
          return data.candidates[0].content.parts[0].text.trim();
        } else {
          console.error('Unexpected Gemini API response:', data);
          return null;
        }
      } catch (error) {
        console.error('Error calling Gemini API:', error);
        return null;
      }
    }
    
    function displayResults(results) {
      searchResultsDiv.innerHTML = '';
      if (results.length === 0) {
        searchResultsDiv.innerHTML = '<p>No results found.</p>';
        return;
      }
      results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.classList.add('result-item');
        resultItem.innerHTML = `
          <h3>Email ID: ${result.id}</h3>
          <p>Snippet: ${result.snippet}</p>
          <p>Body: ${result.body.substring(0, 200)}...</p>
        `;
        searchResultsDiv.appendChild(resultItem);
      });
    }
