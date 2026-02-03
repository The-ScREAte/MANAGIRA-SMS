function confirmEndTerm(termId) {
    if (confirm("Are you sure you want to end this term? This action cannot be undone.")) {
        fetch('/common/deleteTerm', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ term_id: termId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Term ended successfully.');
                window.location.reload();  // Reload to update the list
            } else {
                alert('Failed to end term: ' + data.message);
            }
        })
        .catch(error => alert('Error ending term: ' + error.message));
    }
}
