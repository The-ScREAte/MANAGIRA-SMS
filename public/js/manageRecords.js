function deleteRecord(type, id) {
  const bodyData = {};
  if (type === "announcement") {
    bodyData.announcementId = id;
  } else {
    bodyData.id = id;
  }

  if (confirm("Are you sure you want to delete this " + type + "?")) {
    fetch(`/common/delete${type.charAt(0).toUpperCase() + type.slice(1)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          alert("Deleted successfully!");
          window.location.reload(); // Reload the page to see the changes
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch((error) => {
        console.error("Failed to delete:", error);
        alert("Failed to delete due to an error.");
      });
  }
}

function deleteEvent(eventId) {
  if (confirm("Are you sure you want to delete this event?")) {
    fetch(`/common/deleteEvent`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ eventId: eventId }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          alert("Event deleted successfully!");
          window.location.reload();
        } else {
          alert("Deletion failed: " + data.message);
        }
      })
      .catch((error) => {
        console.error("Deletion error:", error);
        alert("Failed to delete due to an error.");
      });
  }
}

function deleteSchoolYear(yearId) {
  if (confirm("Are you sure you want to delete this school year?")) {
    fetch("/common/deleteSchoolYear", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: yearId }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          alert("School year deleted successfully!");
          window.location.reload();
        } else {
          alert("Deletion failed: " + data.message);
        }
      })
      .catch((error) => {
        console.error("Deletion error:", error);
        alert("Failed to delete due to an error.");
      });
  }
}

async function deleteTerm(termId, button) {
  // Prevent deleting the last term in the school year
  const termSection =
    button.closest(".term-section") ||
    button.closest("form").querySelector(".term-section");
  const termFieldsets = termSection.querySelectorAll("fieldset");
  if (termFieldsets.length <= 1) {
    alert(
      "A school year must have at least one term. You cannot delete the last term."
    );
    return;
  }

  if (!termId || termId === "") {
    // No termId means it's a new, unsaved term – just remove from DOM
    const fieldset = button.closest("fieldset");
    fieldset.remove();
    return;
  }

  if (!confirm("Are you sure you want to delete this term?")) {
    return;
  }

  button.disabled = true;
  button.textContent = "Deleting...";
  try {
    const response = await fetch("/common/deleteTerm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term_id: termId }),
    });
    const data = await response.json();
    if (data.success) {
      const fieldset = button.closest("fieldset");
      fieldset.remove();
      alert("Term deleted successfully.");
    } else {
      alert(data.message || "Failed to delete term.");
      button.disabled = false;
      button.textContent = "Delete Term";
    }
  } catch (err) {
    alert("An error occurred while deleting the term.");
    button.disabled = false;
    button.textContent = "Delete Term";
  }
}

function selectAllClasses(termId, checkbox) {
  const checkboxes = document.querySelectorAll(
    `input[name="term${termId}Classes[]"]`
  );
  checkboxes.forEach((cb) => (cb.checked = checkbox.checked));
}
