var monocles = function() {

  var currentDoc = null,
    oldestDoc = null,
    streamDisabled = false,
    newUser = false;

  var db = couch.db(app.baseURL + "api");
  
  function userProfile() {
    return $( '#header' ).data( 'profile' );
  }

  // binds UX interaction and form submit event handlers to the signup/login forms
  function showLogin() {
    disableStream();

    util.render( 'login', 'stream', { host: document.domain }, false );

    var form = $( "#login form" )
      , button = $( '.login_submit .button' );

    setTimeout( function() {
      $( '.stream' ).fadeIn(200);
      $( 'label', form ).inFieldLabels();
      $( "input[name=username]", form ).focus();
    }, 200);

    $( '.loginToggle' ).click( function ( e ) {
      var label = $( this )
        , labelText = label.text()
        , buttonText = button.text();

      label.text( buttonText );
      button.text( labelText );
    })

    form.submit( function( e ) {
      var type = button.text().trim()
        , name = $( 'input[name=username]', this ).val()
        , pass = $( 'input[name=password]', this ).val(); 

      if ( type === 'Sign up' ) {
        signUp( name, pass );
      } else if ( type === 'Login' ) {
        couch.login( {name: name, password: pass} ).then(fetchSession);
      }

      e.preventDefault();
      return false;
    })

    $( "input", form ).keydown( function( e ) {
       if( e.keyCode == 13 ) form.submit();
    });

    button.click( function( e ) {
      form.submit();
      e.preventDefault();
    });
  }
  
  function signUp( name, pass ) {
    $.couch.signup({
      name : name
    }, pass, {
      success : function() {
        login( name, pass );
        newUser = true;
      }
    });
  }
  
  // checks if the user is logged in and responds accordingly
  function fetchSession() {
    couch.session().then(
      function( session ) {
        if ( session.userCtx.name ) {
          fetchProfile( session, function( profile ) {
            util.render( 'loggedIn', 'account', {
              nickname : profile.nickname,
              gravatar_url : profile.gravatar_url
            });
            getPostsWithComments( { reload: true } );
          });
        } else if ( util.isAdminParty( session.userCtx ) ) {
          util.render( 'adminParty', 'account' );
          getPostsWithComments();
        } else {
          util.render( 'loginButton', 'account' );
          util.render( 'loggedOut', 'header' );
          getPostsWithComments();
        };
      }
    );
  }
  
  // gets user's stored profile info from couch
  // asks them to fill out a form if it's their first login
  function fetchProfile( session, callback ) {
    couch.userDb().then(function(userDb) {
      userDb.get( "org.couchdb.user:" + session.userCtx.name).then(
        function( userDoc ) {
          var profile = userDoc[ "couch.app.profile" ];
          if ( profile ) {
            // we copy the name to the profile so it can be used later
            // without publishing the entire userdoc (roles, pass, etc)
            profile.name = userDoc.name;
            profile.base_url = app.baseURL;
            profileReady( profile );
            callback( profile );
          } else {
            util.render( 'newProfileForm', 'stream', session.userCtx, false );
            $( '.stream form' ).submit( function( e ) {
              alert('woo')
              saveUser( $( this ) );
              e.preventDefault();
              return false;
            });
          }
        }
      )
    })
  }
  
  function saveUser(form) {
    $.couch.app( function( app ) {     
      var md5 = app.require( "common/md5" );

      var name = $( "input[name=userCtxName]", form ).val();
      var newProfile = {
        rand : Math.random().toString(), 
        nickname : $( "input[name=nickname]", form ).val(),
        email : $( "input[name=email]", form ).val(),
        url : $( "input[name=url]", form ).val()
      };

      if ( md5 ) {
        newProfile.gravatar_url = 'http://www.gravatar.com/avatar/' + md5.hex( newProfile.email || newProfile.rand ) + '.jpg?s=50&d=identicon';    
      }

      couch.userDb().then( function( userDb ) {
        var userDocId = "org.couchdb.user:" + name;
        userDb.get( userDocId, {
          success : function( userDoc ) {
            userDoc[ "couch.app.profile" ] = newProfile;
            userDb.saveDoc( userDoc, {
              success : function() {
                newProfile.name = userDoc.name;
                util.render( 'loggedIn', 'account', {
                  nickname : newProfile.nickname,
                  gravatar_url : newProfile.gravatar_url
                });
                getPostsWithComments( { reload: true } );
                profileReady( newProfile );
              }
            });
          }
        });
      });
    });
  }
  
  function profileReady( profile ) {
    $( '#header' ).data( 'profile', profile );
    util.render( 'profileReady', 'header', profile )
    $( 'label' ).inFieldLabels();
    $( 'form.status_message' ).submit( submitPost );
    initFileUpload();
    if ( newUser ) {
      subscribeHub();
      newUser = false;
    }
  }
  
  function addMessageToPhoto(photoDoc, callback) {
    var docAdditions = {
      type: "note",
      _id: photoDoc.id,
      _rev: photoDoc.rev,
      created_at : new Date(),
      profile : userProfile(),
      message : $( "form.status_message [name=message]" ).val(),
      hostname : document.domain
    };

    posts( db ).update( photoDoc.id, docAdditions );
  }
  
  function initFileUpload() {
    var docURL
      , currentFileName
      , uploadSequence = [ ];

    $.getJSON( '/_uuids', function( data ) { 
      docURL = app.baseURL + "api/" + data.uuids[ 0 ] + "/";
    });

    $( '.file_list' ).html( "" );

    var uploadSequence = [];
    uploadSequence.start = function (index, fileName, rev) {
      var next = this[index];
      currentFileName = fileName;
      var url = docURL + fileName;
      if ( rev ) url = url + "?rev=" + rev;
      next(url);
      this[index] = null;
    };

    $('#file_upload').fileUploadUI({
      multipart: false,
      uploadTable: $( '.file_list' ),
      downloadTable: $( '.file_list' ),
      buildUploadRow: function ( files, index ) {
        return $( $.mustache( $( '#uploaderTemplate' ).text(), { name: files[ index ].name } ));
      },
      buildDownloadRow: function ( file ) {
        return $( '<tr><td>' + currentFileName + '<\/td><\/tr>' );
      },
      beforeSend: function (event, files, index, xhr, handler, callBack) {
        uploadSequence.push(function (url) {
          handler.url = url;
          callBack();
        });
        if (index === 0) {
          uploadSequence.splice(0, uploadSequence.length - 1);
        }
        if (index + 1 === files.length) {
          uploadSequence.start(0, files[ index ].fileName);
        }
      },
      onComplete: function (event, files, index, xhr, handler) {
        currentDoc = handler.response;
        var nextUpload = uploadSequence[ index + 1 ];
        if ( nextUpload ) {
          uploadSequence.start( index + 1, files[ index ].fileName, currentDoc.rev );
        } else {
          addMessageToPhoto(currentDoc);
        }
      },
      onAbort: function (event, files, index, xhr, handler) {
        handler.removeNode(handler.uploadRow);
        uploadSequence[index] = null;
        uploadSequence.start(index + 1, handler.url);
      }
    });
  }
  
  // pubsubhubbubb notification functions
  function subscribeHub() {
    var callbackURL = "http://" + document.domain + app.baseURL + "push"
      , topicURL = "http://" + document.domain + app.baseURL + "feeds/" + userProfile().name;
    $.post(app.hubURL, { 
      "hub.mode": "subscribe", "hub.verify": "sync", "hub.topic": topicURL, "hub.callback": callbackURL
    })
  }
  
  function pingHub() {
    var publishURL = "http://" + document.domain + app.baseURL + "feeds/" + userProfile().name;
    $.post(app.hubURL, { 
      "hub.mode": "publish", "hub.url": publishURL
    })
  }
  
  function submitPost( e ) {
    var form = this;
    var date = new Date();
    var doc = {
      type: "note",
      created_at : date,
      profile : userProfile(),
      message : $( "[name=message]", form ).val(),
      hostname : document.domain
    };

    if ( currentDoc ) {
      posts( db ).update( currentDoc.id, { message: doc.message }).addCallback( afterPost );
    } else {
      posts( db ).save( doc ).addCallback( afterPost );
    }

    e.preventDefault();
    return false;
  }
  
  function afterPost( newDoc ) {
    // Clear post entry form
    $( "form.status_message [name=message]" ).val( "" );
    $( '.file_list' ).html( "" );
    currentDoc = null;

    // Reload posts
    getPostsWithComments( { reload: true } );

    // notify the pubsubhubbub hub
    pingHub();
  }
  
  function randomToken() {
    return String( Math.floor( Math.random() * 1000 ) );
  }

  function disableStream() {
    if ( streamDisabled === false ) {
      $( 'header' ).fadeOut( 200 );
      $( '.stream' ).hide();
      streamDisabled = true;
    }
  }

  function enableStream() {
    if ( streamDisabled ) {
      $( 'header' ).fadeIn( 200 );
      $( '.stream' ).show();
      streamDisabled = false;
    }
  }

  function showLoader() {
    $( '.loader' ).removeClass( 'hidden' );
  }

  function hideLoader() {
    $( '.loader' ).addClass( 'hidden' );
  }

  function loaderShowing() {
    var showing = false;
    if( $( '.loader' ).css( 'display' ) !== "none" ) showing = true;
    return showing;
  }
  
  function getPostsWithComments( opts ) {
    enableStream();
    var opts = opts || {};
    if( opts.offsetDoc === false ) return;
    var posts, comments;
    showLoader();

    // Renders only when posts and comments are both loaded.
    function renderStream() {
       if ( posts && comments ) {
        hideLoader();

        if ( posts.length > 0 ) {
          var append = true;
          if ( opts.reload ) append = false;
          util.render( 'stream', 'stream', renderPostsWithComments( posts, comments ), append );
        } else if ( ! opts.offsetDoc ){
          util.render( 'empty', 'stream' );
        }
      }
    }

    var query = {
      "descending" : true,
      "limit" : 20
    }

    if ( opts.offsetDoc ) {
      $.extend( query, {
        "startkey": opts.offsetDoc.key,
        "startkey_docid": opts.offsetDoc.id,
        "skip": 1
      })
    }

    couch.get('api/stream', {data: query} ).then(
      function( data ) {
        if( data.rows.length === 0 ) {
          oldestDoc = false;
          hideLoader();
          posts = [];
        } else {
          oldestDoc = data.rows[ data.rows.length - 1 ];
          posts = data.rows;
        }
        renderStream();
      }
    );

    var commentsQuery = {
      "descending" : true,
      "limit" : 250
    }
    
    couch.get( 'api/comments', {data: commentsQuery}).then( 
      function( data ) {
        comments = data;

        // Reverse order of comments
        comments.rows = comments.rows.reduceRight( function( list, c ) {
          list.push( c );
          return list;
        }, [] );

        renderStream();
      }
    );
  }

  function renderPostsWithComments( posts, comments ) {
    var data = {
      items : posts.map( function( r ) {
        var postComments = comments.rows.filter( function( cr ) {
              return cr.value.parent_id === r.id;
            }).map( function( cr ) {
              return $.extend({
                id : cr.id,
                created: cr.value.created_at,
                message : util.linkSplit( cr.value.message )
              }, cr.value.profile );
            })

          , attachments = Object.keys( r.value._attachments || {} ).map( function( file ) {
              return {
                file : file,
                randomToken : randomToken()
              };
            });

        return $.extend({
          comments : postComments,
          latestComments: postComments.slice( -2 ),  // grab the last 2 comments
          hasComments : postComments.length > 0,
          hasHiddenComments : postComments.length > 2,
          commentCount : postComments.length,
          hiddenCommentCount : postComments.length - 2,
          randomToken : randomToken(),
          message : util.linkSplit( r.value.message ),
          id: r.id,
          created_at : r.value.created_at,
      		hostname : r.value.hostname || "unknown",
          attachments : attachments
        }, r.value.profile );
      }),
      profile: userProfile(),
      db : "monocles",
      host: document.domain
    };
    data[ 'notid' ] = data[ 'items' ][ 0 ][ 'id' ];
    return data;
  }

  function getComments( post_id, callback ) {
    db.view( config.design + '/comments', {
      startkey: [ post_id ],
      endkey: [ post_id + "\u9999" ],
      success: function( data ) {
        callback( post_id, data );
      }
    });
  }

  function formatComments( post_id, data ) {
    var comments = data.rows.map( function( r ) {
      return $.extend({
        id : r.id,
        created: r.value.created_at,
        message : util.linkSplit( r.value.message ),
  			hostname : r.value.hostname || "unknown",
  			randomToken : randomToken()
      }, r.value.profile );
    });

    return {
      id : post_id,
      host: document.domain,
      empty : comments.length === 0,
      comments : comments
    };
  }

  function showComments( post_id, post ) {
    getComments( post_id, function( post_id, data ) {
      post.html( $.mustache( $( '#commentsTemplate' ).text(), formatComments( post_id, data ) ) );
      post.show().find( '*' ).show();
      post.closest( 'li' ).find( 'a.show_post_comments' ).hide().end().find( 'a.hide_post_comments' ).show();
      post.find( 'label' ).inFieldLabels();
      post.find( '.timeago' ).timeago();
      $( 'form', post ).submit( submitComment );
      $( ".hover_profile", post ).cluetip( { local: true, sticky: true, activation: "click" } );
    });
  }

  function submitComment( e ) {
    var form = $(this)
      , date = new Date()
      , parent = form.closest( '.stream_element' )
      , parent_id = parent.attr( 'data-post-id' )
      , parent_created_at = parent.attr( 'data-created-at' )
      , doc = {
          created_at : date,
          profile : userProfile(),
          message : form.find( '[name=message]' ).val(),
      	  hostname : document.domain,
          parent_id : parent_id,
          parent_created_at : parent_created_at
      };

    comments( db ).save( doc ).addCallback( function( savedComment ) {
      form.find( '[name=message]' ).val( '' );
      showComments( parent_id, form.closest( 'div.comments' ) );
    });

    e.preventDefault();
  }

  function decorateStream() {
  	$( ".hover_profile" ).cluetip( { local: true, sticky: true, activation: "click" } );
    $( '.timeago' ).timeago();
  	$( 'a.hide_post_comments' ).click( function( e ) {
      var comment = $( this ).closest( 'li' ).find( 'div.comments' );
      comment.find( '*' ).remove();
      comment.closest( 'li' ).find( 'a.hide_post_comments' ).hide().end().find( 'a.show_post_comments' ).show();
      e.preventDefault();
  	})

  	$( 'a.show_post_comments' ).click( function( e ) {
  	  var postComments = $( this );
      var post = postComments.closest( '.stream_element' ).find( 'div.comments' )
        , post_id = postComments.closest( '.stream_element' ).attr( 'data-post-id' );

      showComments( post_id, post );
      e.preventDefault();
  	})
  }

  function bindInfiniteScroll() {
    var settings = {
      lookahead: 400,
      container: $( document )
    };

    $( window ).scroll( function( e ) {
      if ( loaderShowing() || streamDisabled ) {
        return;
      }

      var containerScrollTop = settings.container.scrollTop();
      if ( ! containerScrollTop ) {
        var ownerDoc = settings.container.get().ownerDocument;
        if( ownerDoc ) {
          containerScrollTop = $( ownerDoc.body ).scrollTop();        
        }
      }
      var distanceToBottom = $( document ).height() - ( containerScrollTop + $( window ).height() );

      if ( distanceToBottom < settings.lookahead ) {  
        getPostsWithComments( { offsetDoc: oldestDoc } );
      }
    });
  }
  
  return {
    db: db,
    userProfile: userProfile,
    showLogin: showLogin,
    fetchSession: fetchSession,
    fetchProfile: fetchProfile,
    saveUser: saveUser,
    profileReady: profileReady,
    addMessageToPhoto: addMessageToPhoto,
    initFileUpload: initFileUpload,
    subscribeHub: subscribeHub,
    pingHub: pingHub,
    submitPost: submitPost,
    afterPost: afterPost,
    randomToken: randomToken,
    signUp: signUp,
    disableStream: disableStream,
    enableStream: enableStream,
    showLoader: showLoader,
    hideLoader: hideLoader,
    loaderShowing: loaderShowing,
    getPostsWithComments: getPostsWithComments,
    renderPostsWithComments: renderPostsWithComments,
    getComments: getComments,
    formatComments: formatComments,
    showComments: showComments,
    submitComment: submitComment,
    decorateStream: decorateStream,
    bindInfiniteScroll: bindInfiniteScroll
  }
  
}();